/**
 * Amazon Bedrock provider for the extract step: one Converse call with a
 * single tool whose input schema is the spec's output schema.
 *
 * Field names follow the installed @aws-sdk/client-bedrock-runtime types
 * (ConverseCommandInput: system, messages, inferenceConfig, toolConfig
 * { tools: [{ toolSpec: { name, description, inputSchema: { json } } }],
 * toolChoice: { auto: {} } | { tool: { name } } }, additionalModelRequestFields;
 * image content block { image: { format, source: { bytes } } }).
 *
 * Credentials come from the SDK default chain (the Amplify compute role in
 * production). Region: APP_AWS_REGION, then AWS_REGION, then the SDK chain.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type ConverseCommandInput,
  type ConverseCommandOutput,
  type ImageFormat,
  type Message,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import { awsRegion } from "@/lib/env";
import type { ListingModelConfig } from "./config";
import { buildUserText, retryText, systemPromptFor } from "./prompt";
import { OUTPUT_JSON_SCHEMA, TOOL_DESCRIPTION, TOOL_NAME } from "./schema";
import { EXTRACT_LIMITS, type ExtractInput, type ExtractModel, type FailedAttempt, type ModelReply } from "./types";

type DocumentType = ToolInputSchema.JsonMember["json"];

const IMAGE_FORMATS: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** The Converse image format for a content type, or null if Bedrock does not take it. */
export function imageFormatOf(contentType: string): ImageFormat | null {
  return IMAGE_FORMATS[contentType.toLowerCase()] ?? null;
}

/** Anything with the client's send(); lets tests replace the network call. */
export interface ConverseSender {
  send(command: ConverseCommand, options?: { abortSignal?: AbortSignal }): Promise<ConverseCommandOutput>;
}

const holder = globalThis as typeof globalThis & {
  __listingBedrockClients?: Map<string, BedrockRuntimeClient>;
};

/** One client per region for the process. */
export function getBedrockClient(region: string | undefined = awsRegion()): BedrockRuntimeClient {
  holder.__listingBedrockClients ??= new Map();
  const key = region ?? "";
  let client = holder.__listingBedrockClients.get(key);
  if (!client) {
    // The extract step has its own 15 s budget; keep SDK retries short.
    client = new BedrockRuntimeClient({ region, maxAttempts: 2 });
    holder.__listingBedrockClients.set(key, client);
  }
  return client;
}

function firstUserMessage(input: ExtractInput): Message {
  const content: ContentBlock[] = [];
  if (input.photo) {
    const format = imageFormatOf(input.photo.content_type);
    if (!format) throw new Error(`Unsupported photo type for Bedrock: ${input.photo.content_type}`);
    content.push({ image: { format, source: { bytes: input.photo.bytes } } });
  }
  content.push({ text: buildUserText(input) });
  return { role: "user", content };
}

/** Append a failed attempt and its validation error to the conversation. */
function appendRetry(messages: Message[], attempt: FailedAttempt): void {
  const text = retryText(attempt.validationError);
  const previous = attempt.reply.message as Message | null | undefined;
  const content = previous?.content ?? [];
  if (content.length === 0) {
    // An empty assistant turn cannot be replayed; add the error to the last user turn.
    const last = messages[messages.length - 1];
    last.content = [...(last.content ?? []), { text }];
    return;
  }
  messages.push({ role: "assistant", content });
  const toolUseIds = content.flatMap((block) => (block.toolUse?.toolUseId ? [block.toolUse.toolUseId] : []));
  const reply: ContentBlock[] = toolUseIds.map((toolUseId) => ({
    toolResult: { toolUseId, status: "error", content: [{ text }] },
  }));
  if (reply.length === 0) reply.push({ text });
  messages.push({ role: "user", content: reply });
}

/** The ConverseCommand input for one attempt. Exported for tests. */
export function buildConverseInput(
  config: Pick<ListingModelConfig, "modelId" | "temperature" | "toolChoice" | "extraFields"> &
    Partial<Pick<ListingModelConfig, "promptVariant">>,
  input: ExtractInput,
  previous: readonly FailedAttempt[],
): ConverseCommandInput {
  if (!config.modelId) throw new Error("LISTING_MODEL_ID is required for the bedrock provider.");
  const messages: Message[] = [firstUserMessage(input)];
  for (const attempt of previous) appendRetry(messages, attempt);

  const request: ConverseCommandInput = {
    modelId: config.modelId,
    system: [{ text: systemPromptFor(config.promptVariant ?? "spec") }],
    messages,
    inferenceConfig: {
      maxTokens: EXTRACT_LIMITS.maxOutputTokens,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    },
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: TOOL_NAME,
            description: TOOL_DESCRIPTION,
            inputSchema: { json: OUTPUT_JSON_SCHEMA as unknown as DocumentType },
          },
        },
      ],
      toolChoice: config.toolChoice === "tool" ? { tool: { name: TOOL_NAME } } : { auto: {} },
    },
  };
  if (config.extraFields) {
    request.additionalModelRequestFields = config.extraFields as unknown as DocumentType;
  }
  return request;
}

/** Read the tool input (or text) out of a Converse response. */
export function readConverseReply(response: ConverseCommandOutput): ModelReply {
  const message = response.output?.message ?? null;
  const content = message?.content ?? [];
  const toolUse = content.find((block) => block.toolUse?.name === TOOL_NAME)?.toolUse;
  const text = content
    .map((block) => block.text ?? "")
    .filter((part) => part.trim() !== "")
    .join("\n");
  return {
    toolInput: toolUse ? toolUse.input : undefined,
    text: text === "" ? null : text,
    stopReason: response.stopReason ?? null,
    message,
  };
}

export function createBedrockModel(
  config: ListingModelConfig,
  sender: ConverseSender = getBedrockClient(),
): ExtractModel {
  return {
    provider: "bedrock",
    modelId: config.modelId,
    async call(input, previous, signal) {
      const command = new ConverseCommand(buildConverseInput(config, input, previous));
      const response = await sender.send(command, { abortSignal: signal });
      return readConverseReply(response);
    },
  };
}
