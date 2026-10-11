/**
 * Driver selection, in one place. Every module that picks an implementation
 * (lib/store, lib/photos, lib/extract) reads its driver from here.
 *
 * | Variable               | Choices          | Default (dev, test) | Default (NODE_ENV=production) | Needs              |
 * |------------------------|------------------|---------------------|-------------------------------|--------------------|
 * | STORE_DRIVER           | memory, dynamodb | memory              | dynamodb                      | DYNAMODB_TABLE     |
 * | PHOTOS_DRIVER          | local, s3        | local               | s3                            | PHOTOS_BUCKET      |
 * | LISTING_MODEL_PROVIDER | fake, bedrock    | fake                | bedrock                       | LISTING_MODEL_ID   |
 *
 * Local dev needs no AWS at all. In production the defaults are the AWS
 * drivers, so a deployment that forgets a variable fails at startup
 * (instrumentation.ts -> assertStartupConfig) with a message naming it,
 * instead of silently keeping data in one process. The local drivers can
 * still be chosen explicitly in production (for a single-process demo or an
 * e2e run against `next start`); that logs a warning.
 *
 * Region for every AWS client: APP_AWS_REGION, then AWS_REGION, then the SDK's
 * own chain (lib/env awsRegion()).
 */

export type Env = Record<string, string | undefined>;

export const STORE_DRIVERS = ["memory", "dynamodb"] as const;
export type StoreDriver = (typeof STORE_DRIVERS)[number];

export const PHOTOS_DRIVERS = ["local", "s3"] as const;
export type PhotosDriver = (typeof PHOTOS_DRIVERS)[number];

export const LISTING_PROVIDERS = ["bedrock", "fake"] as const;
export type ListingProvider = (typeof LISTING_PROVIDERS)[number];

/** A configuration value is invalid or missing. The message names the variable. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

function value(env: Env, name: string): string | undefined {
  const raw = env[name]?.trim();
  return raw ? raw : undefined;
}

/** NODE_ENV=production in `env` (falling back to the process when `env` does not say). */
export function isProductionEnv(env: Env = process.env): boolean {
  return (env.NODE_ENV ?? process.env.NODE_ENV) === "production";
}

function choose<T extends string>(
  env: Env,
  name: string,
  choices: readonly T[],
  devDefault: T,
  productionDefault: T,
): T {
  const raw = value(env, name)?.toLowerCase();
  if (raw === undefined) return isProductionEnv(env) ? productionDefault : devDefault;
  if ((choices as readonly string[]).includes(raw)) return raw as T;
  throw new ConfigError(`${name} must be one of ${choices.join(", ")}; got "${raw}".`);
}

/** STORE_DRIVER: memory (dev default) or dynamodb (production default). Throws ConfigError on an unknown value. */
export function storeDriver(env: Env = process.env): StoreDriver {
  return choose(env, "STORE_DRIVER", STORE_DRIVERS, "memory", "dynamodb");
}

/** PHOTOS_DRIVER: local (dev default) or s3 (production default). Throws ConfigError on an unknown value. */
export function photosDriver(env: Env = process.env): PhotosDriver {
  return choose(env, "PHOTOS_DRIVER", PHOTOS_DRIVERS, "local", "s3");
}

/** LISTING_MODEL_PROVIDER: fake (dev default) or bedrock (production default). Throws ConfigError on an unknown value. */
export function listingProvider(env: Env = process.env): ListingProvider {
  return choose(env, "LISTING_MODEL_PROVIDER", LISTING_PROVIDERS, "fake", "bedrock");
}

/** True when LISTING_MODEL_PROVIDER was left unset (the default was used). */
export function listingProviderIsDefault(env: Env = process.env): boolean {
  return value(env, "LISTING_MODEL_PROVIDER") === undefined;
}

/**
 * Test-only HTTP hooks (app/api/e2e/**) for scripts/e2e.ts. On only when
 * E2E_HOOKS=1 and NODE_ENV is not production; in production they are always
 * off, whatever E2E_HOOKS says.
 */
export function e2eHooksEnabled(env: Env = process.env): boolean {
  return value(env, "E2E_HOOKS") === "1" && !isProductionEnv(env);
}

export interface DriverSelection {
  store: StoreDriver;
  photos: PhotosDriver;
  listing: ListingProvider;
}

export interface ConfigReport {
  production: boolean;
  /** null when a driver variable itself is invalid. */
  drivers: DriverSelection | null;
  /** Problems that stop the app from working. In production they stop it at startup. */
  errors: string[];
  /** Worth knowing, not fatal. */
  warnings: string[];
}

function attempt<T>(errors: string[], read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return null;
  }
}

/** Check the whole configuration without throwing. */
export function checkConfig(env: Env = process.env): ConfigReport {
  const production = isProductionEnv(env);
  const errors: string[] = [];
  const warnings: string[] = [];

  const store = attempt(errors, () => storeDriver(env));
  const photos = attempt(errors, () => photosDriver(env));
  const listing = attempt(errors, () => listingProvider(env));

  const defaulted = (name: string, driver: string) =>
    value(env, name) === undefined ? ` (${name} is not set, so production uses ${driver})` : "";

  if (store === "dynamodb" && value(env, "DYNAMODB_TABLE") === undefined) {
    errors.push(
      `DYNAMODB_TABLE is required when STORE_DRIVER=dynamodb${defaulted("STORE_DRIVER", "dynamodb")}. ` +
        "Set DYNAMODB_TABLE to the table name, or STORE_DRIVER=memory to keep data in this process only.",
    );
  }
  if (photos === "s3" && value(env, "PHOTOS_BUCKET") === undefined) {
    errors.push(
      `PHOTOS_BUCKET is required when PHOTOS_DRIVER=s3${defaulted("PHOTOS_DRIVER", "s3")}. ` +
        "Set PHOTOS_BUCKET to the photos bucket, or PHOTOS_DRIVER=local to write photos to this server's disk.",
    );
  }
  if (listing === "bedrock" && value(env, "LISTING_MODEL_ID") === undefined) {
    errors.push(
      `LISTING_MODEL_ID is required when LISTING_MODEL_PROVIDER=bedrock${defaulted("LISTING_MODEL_PROVIDER", "bedrock")}. ` +
        "Set LISTING_MODEL_ID to a Bedrock model or inference profile id, or LISTING_MODEL_PROVIDER=fake for the rule-based stand-in.",
    );
  }

  if (production) {
    if (store === "memory") {
      warnings.push("STORE_DRIVER=memory in production: data lives in this process only and is lost on restart.");
    }
    if (photos === "local") {
      warnings.push("PHOTOS_DRIVER=local in production: photos are written to this server's disk.");
    }
    if (listing === "fake") {
      warnings.push("LISTING_MODEL_PROVIDER=fake in production: drafts come from the rule-based stand-in, not a model.");
    }
    if (value(env, "E2E_HOOKS") !== undefined) {
      warnings.push("E2E_HOOKS is ignored in production: the test hooks are always off.");
    }
    const usesAws = store === "dynamodb" || photos === "s3" || listing === "bedrock";
    const region = value(env, "APP_AWS_REGION") ?? value(env, "AWS_REGION");
    if (usesAws && region === undefined) {
      warnings.push("Neither APP_AWS_REGION nor AWS_REGION is set: the AWS SDK uses its default region chain.");
    }
  }

  const drivers = store && photos && listing ? { store, photos, listing } : null;
  return { production, drivers, errors, warnings };
}

/**
 * Run at server start (instrumentation.ts). Logs the drivers and any
 * warnings. Throws a ConfigError listing every problem when the
 * configuration is broken in production; outside production it only logs
 * them, and the first request that needs the broken driver fails.
 */
export function assertStartupConfig(env: Env = process.env, log: Pick<Console, "log" | "warn" | "error"> = console): ConfigReport {
  const report = checkConfig(env);
  if (report.drivers) {
    log.log(
      `[config] drivers: store=${report.drivers.store} photos=${report.drivers.photos} listing=${report.drivers.listing}` +
        (report.production ? " (production)" : ""),
    );
  }
  for (const warning of report.warnings) log.warn(`[config] ${warning}`);
  if (report.errors.length > 0) {
    const message = `Configuration error:\n- ${report.errors.join("\n- ")}`;
    if (report.production) throw new ConfigError(message);
    log.error(`[config] ${message}`);
  }
  return report;
}
