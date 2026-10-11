/**
 * Offline checks of infra/template.yaml (CloudFormation):
 * - it parses (with CloudFormation's short-form tags);
 * - its DynamoDB table matches the driver's tableDefinition();
 * - every Ref, GetAtt, Sub variable and Condition points at something that exists;
 * - the app policy allows exactly the DynamoDB actions the driver sends, and
 *   the bucket is public only under photos/.
 * Needs js-yaml (installed with eslint); skipped with a message otherwise.
 * This is not cfn-lint: property schemas are not checked here.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tableDefinition } from "@/lib/store/dynamodb";

type Json = unknown;
interface YamlType {
  new (tag: string, options: { kind: "scalar" | "sequence" | "mapping"; construct: (data: Json) => Json }): unknown;
}
interface JsYaml {
  Type: YamlType;
  DEFAULT_SCHEMA: { extend(types: unknown[]): unknown };
  load(text: string, options: { schema: unknown }): Json;
}

function loadJsYaml(): JsYaml | null {
  try {
    return createRequire(import.meta.url)("js-yaml") as JsYaml;
  } catch {
    return null;
  }
}

const TEMPLATE_PATH = fileURLToPath(new URL("../../infra/template.yaml", import.meta.url));

const INTRINSICS = ["Ref", "Condition", "Sub", "GetAtt", "If", "Equals", "Not", "And", "Or", "Join", "Select", "Split", "FindInMap", "Base64", "ImportValue", "GetAZs", "Cidr"];

function parseTemplate(jsyaml: JsYaml): Record<string, Json> {
  const types = INTRINSICS.flatMap((name) =>
    (["scalar", "sequence", "mapping"] as const).map(
      (kind) =>
        new jsyaml.Type(`!${name}`, {
          kind,
          construct: (data) => {
            const key = name === "Ref" || name === "Condition" ? name : `Fn::${name}`;
            const value = name === "GetAtt" && typeof data === "string" ? data.split(".") : data;
            return { [key]: value };
          },
        }),
    ),
  );
  return jsyaml.load(readFileSync(TEMPLATE_PATH, "utf8"), { schema: jsyaml.DEFAULT_SCHEMA.extend(types) }) as Record<string, Json>;
}

/** Every object in the tree that has `key` as its only property. */
function findIntrinsics(node: Json, key: string, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((child) => findIntrinsics(child, key, out));
  else if (node && typeof node === "object") {
    const entries = Object.entries(node);
    if (entries.length === 1 && entries[0][0] === key) out.push(entries[0][1]);
    entries.forEach(([, child]) => findIntrinsics(child, key, out));
  }
  return out;
}

const jsyaml = loadJsYaml();

if (!jsyaml) {
  describe("infra/template.yaml", () => {
    it.skip("SKIPPED: js-yaml is not installed, so the CloudFormation template was not checked", () => {});
  });
} else {
  describe("infra/template.yaml", () => {
    const template = parseTemplate(jsyaml);
    const resources = template.Resources as Record<string, { Type: string; Condition?: string; Properties: Record<string, Json> }>;
    const parameters = Object.keys((template.Parameters ?? {}) as object);
    const conditions = Object.keys((template.Conditions ?? {}) as object);
    const outputs = (template.Outputs ?? {}) as Record<string, { Condition?: string; Value: Json }>;

    it("defines the table the DynamoDB driver expects", () => {
      const table = resources.Table;
      expect(table.Type).toBe("AWS::DynamoDB::Table");
      const expected = tableDefinition("ignored");
      const byName = <T extends { AttributeName?: string; IndexName?: string }>(rows: T[]) =>
        [...rows].sort((a, b) => String(a.AttributeName ?? a.IndexName).localeCompare(String(b.AttributeName ?? b.IndexName)));
      expect(table.Properties.BillingMode).toBe(expected.BillingMode);
      expect(table.Properties.KeySchema).toEqual(expected.KeySchema);
      expect(byName(table.Properties.AttributeDefinitions as { AttributeName: string }[])).toEqual(
        byName(expected.AttributeDefinitions as { AttributeName: string }[]),
      );
      expect(byName(table.Properties.GlobalSecondaryIndexes as { IndexName: string }[])).toEqual(
        byName(expected.GlobalSecondaryIndexes as { IndexName: string }[]),
      );
    });

    it("resolves every Ref, GetAtt, Sub variable and Condition", () => {
      const names = new Set([...parameters, ...Object.keys(resources)]);
      const pseudo = (name: string) => name.startsWith("AWS::");
      for (const ref of findIntrinsics(template, "Ref")) {
        expect(typeof ref === "string" && (names.has(ref) || pseudo(ref)), `Ref ${String(ref)}`).toBe(true);
      }
      for (const att of findIntrinsics(template, "Fn::GetAtt")) {
        const [resource] = att as string[];
        expect(Object.keys(resources), `GetAtt ${String(att)}`).toContain(resource);
      }
      for (const sub of findIntrinsics(template, "Fn::Sub")) {
        const text = Array.isArray(sub) ? String(sub[0]) : String(sub);
        const local = Array.isArray(sub) ? Object.keys((sub[1] ?? {}) as object) : [];
        for (const [, variable] of text.matchAll(/\$\{([^}!]+)\}/g)) {
          const head = variable.split(".")[0];
          const ok = names.has(head) || pseudo(variable) || local.includes(variable);
          expect(ok, `Sub variable \${${variable}} in "${text}"`).toBe(true);
          if (variable.includes(".")) expect(Object.keys(resources)).toContain(head);
        }
      }
      const usedConditions = [
        ...Object.values(resources).flatMap((r) => (r.Condition ? [r.Condition] : [])),
        ...Object.values(outputs).flatMap((o) => (o.Condition ? [o.Condition] : [])),
        ...findIntrinsics(template, "Fn::If").map((args) => (args as Json[])[0] as string),
      ];
      for (const c of usedConditions) expect(conditions, `Condition ${c}`).toContain(c);
      // A conditional output may only read a resource that exists under the same condition.
      for (const [name, output] of Object.entries(outputs)) {
        for (const att of findIntrinsics(output.Value, "Fn::GetAtt")) {
          const resource = resources[(att as string[])[0]];
          if (resource.Condition) expect(output.Condition, `Output ${name}`).toBe(resource.Condition);
        }
      }
    });

    it("grants the app exactly the DynamoDB actions the driver uses, and no Scan", () => {
      const statements = (resources.AppAccessPolicy.Properties.PolicyDocument as { Statement: Json[] }).Statement;
      const table = statements.find((s) => (s as { Sid?: string }).Sid === "TableReadWrite") as { Action: string[] };
      expect([...table.Action].sort()).toEqual(
        ["dynamodb:BatchGetItem", "dynamodb:DeleteItem", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem"].sort(),
      );
      // No wildcard actions anywhere in the app policy.
      expect(JSON.stringify(statements)).not.toMatch(/"(dynamodb|s3|bedrock):\*"|"Action":"\*"|dynamodb:Scan/);
    });

    it("makes only photos/ public and keeps ACLs off", () => {
      const bucket = resources.PhotosBucket.Properties;
      expect(bucket.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      });
      const policy = resources.PhotosBucketPolicy.Properties.PolicyDocument as {
        Statement: { Effect: string; Principal: Json; Action: Json; Resource: Json }[];
      };
      const publicAllows = policy.Statement.filter((s) => s.Effect === "Allow" && s.Principal === "*");
      expect(publicAllows).toHaveLength(1);
      expect(publicAllows[0].Action).toBe("s3:GetObject");
      expect(publicAllows[0].Resource).toEqual({ "Fn::Sub": "${PhotosBucket.Arn}/photos/*" });
    });

    it("lets Amplify assume the SSR compute role and outputs what the app needs", () => {
      const trust = resources.SsrComputeRole.Properties.AssumeRolePolicyDocument as {
        Statement: { Principal: { Service: string }; Action: string }[];
      };
      expect(trust.Statement).toHaveLength(1);
      expect(trust.Statement[0].Principal.Service).toBe("amplify.amazonaws.com");
      expect(trust.Statement[0].Action).toBe("sts:AssumeRole");
      expect(Object.keys(outputs)).toEqual(expect.arrayContaining(["TableName", "PhotosBucketName", "SsrComputeRoleArn", "Region"]));
    });
  });
}
