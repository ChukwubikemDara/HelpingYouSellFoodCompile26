import { describe, expect, it, vi } from "vitest";
import {
  ConfigError,
  assertStartupConfig,
  checkConfig,
  e2eHooksEnabled,
  listingProvider,
  photosDriver,
  storeDriver,
} from "@/lib/config";

const DEV = { NODE_ENV: "development" };
const PROD = { NODE_ENV: "production" };
const AWS_READY = {
  ...PROD,
  DYNAMODB_TABLE: "app-main",
  PHOTOS_BUCKET: "app-photos",
  LISTING_MODEL_ID: "model-id",
  APP_AWS_REGION: "us-east-1",
};

function quietLog() {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("driver selection", () => {
  it("defaults to the local drivers outside production", () => {
    expect(storeDriver(DEV)).toBe("memory");
    expect(photosDriver(DEV)).toBe("local");
    expect(listingProvider(DEV)).toBe("fake");
    expect(storeDriver({ NODE_ENV: "test" })).toBe("memory");
  });

  it("defaults to the AWS drivers in production", () => {
    expect(storeDriver(PROD)).toBe("dynamodb");
    expect(photosDriver(PROD)).toBe("s3");
    expect(listingProvider(PROD)).toBe("bedrock");
  });

  it("uses an explicit choice, trimmed and case-insensitive, in any environment", () => {
    expect(storeDriver({ ...PROD, STORE_DRIVER: " Memory " })).toBe("memory");
    expect(photosDriver({ ...DEV, PHOTOS_DRIVER: "S3" })).toBe("s3");
    expect(listingProvider({ ...PROD, LISTING_MODEL_PROVIDER: "fake" })).toBe("fake");
    expect(storeDriver({ ...PROD, STORE_DRIVER: "" })).toBe("dynamodb");
  });

  it("rejects unknown values with the variable's name", () => {
    expect(() => storeDriver({ STORE_DRIVER: "postgres" })).toThrow(ConfigError);
    expect(() => storeDriver({ STORE_DRIVER: "postgres" })).toThrow(/STORE_DRIVER/);
    expect(() => photosDriver({ PHOTOS_DRIVER: "gcs" })).toThrow(/PHOTOS_DRIVER/);
    expect(() => listingProvider({ LISTING_MODEL_PROVIDER: "openai" })).toThrow(/LISTING_MODEL_PROVIDER/);
  });
});

describe("checkConfig", () => {
  it("needs nothing for local dev", () => {
    const report = checkConfig(DEV);
    expect(report.errors).toEqual([]);
    expect(report.drivers).toEqual({ store: "memory", photos: "local", listing: "fake" });
  });

  it("names every AWS variable missing in production", () => {
    const report = checkConfig(PROD);
    expect(report.production).toBe(true);
    expect(report.errors).toHaveLength(3);
    expect(report.errors.join("\n")).toMatch(/DYNAMODB_TABLE is required when STORE_DRIVER=dynamodb \(STORE_DRIVER is not set/);
    expect(report.errors.join("\n")).toMatch(/PHOTOS_BUCKET is required/);
    expect(report.errors.join("\n")).toMatch(/LISTING_MODEL_ID is required/);
  });

  it("is clean in production with every AWS variable set", () => {
    const report = checkConfig(AWS_READY);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.drivers).toEqual({ store: "dynamodb", photos: "s3", listing: "bedrock" });
  });

  it("flags an AWS driver chosen in dev without its variable", () => {
    expect(checkConfig({ ...DEV, STORE_DRIVER: "dynamodb" }).errors[0]).toMatch(/DYNAMODB_TABLE/);
  });

  it("allows the local drivers in production when chosen explicitly, with warnings", () => {
    const report = checkConfig({ ...PROD, STORE_DRIVER: "memory", PHOTOS_DRIVER: "local", LISTING_MODEL_PROVIDER: "fake" });
    expect(report.errors).toEqual([]);
    expect(report.warnings.join("\n")).toMatch(/STORE_DRIVER=memory/);
    expect(report.warnings.join("\n")).toMatch(/PHOTOS_DRIVER=local/);
    expect(report.warnings.join("\n")).toMatch(/LISTING_MODEL_PROVIDER=fake/);
  });

  it("warns that E2E_HOOKS is ignored in production", () => {
    expect(checkConfig({ ...AWS_READY, E2E_HOOKS: "1" }).warnings.join("\n")).toMatch(/E2E_HOOKS is ignored/);
  });

  it("reports an invalid driver value as an error, not a throw", () => {
    const report = checkConfig({ ...DEV, PHOTOS_DRIVER: "ftp" });
    expect(report.drivers).toBeNull();
    expect(report.errors[0]).toMatch(/PHOTOS_DRIVER/);
  });
});

describe("assertStartupConfig", () => {
  it("throws in production when the configuration is broken", () => {
    expect(() => assertStartupConfig(PROD, quietLog())).toThrow(ConfigError);
  });

  it("only logs the problem outside production", () => {
    const log = quietLog();
    const report = assertStartupConfig({ ...DEV, STORE_DRIVER: "dynamodb" }, log);
    expect(report.errors).toHaveLength(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/DYNAMODB_TABLE/));
  });

  it("logs the chosen drivers", () => {
    const log = quietLog();
    assertStartupConfig(AWS_READY, log);
    expect(log.log).toHaveBeenCalledWith(expect.stringMatching(/store=dynamodb photos=s3 listing=bedrock \(production\)/));
  });
});

describe("e2eHooksEnabled", () => {
  it("is on only with E2E_HOOKS=1 outside production", () => {
    expect(e2eHooksEnabled({ ...DEV, E2E_HOOKS: "1" })).toBe(true);
    expect(e2eHooksEnabled({ ...DEV })).toBe(false);
    expect(e2eHooksEnabled({ ...DEV, E2E_HOOKS: "true" })).toBe(false);
    expect(e2eHooksEnabled({ ...PROD, E2E_HOOKS: "1" })).toBe(false);
  });
});
