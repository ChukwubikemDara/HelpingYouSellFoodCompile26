import { afterEach, describe, expect, it } from "vitest";
import { createMemoryStore, getMemoryStore, resetMemoryStore } from "@/lib/store/memory";
import { getStore, resetStore, setStore, storeDriver } from "@/lib/store";
import { runStoreConformance } from "./conformance";

runStoreConformance("memory (fresh store per test)", () => createMemoryStore());

// Same suite against one shared instance, as the DynamoDB driver will run it.
const shared = createMemoryStore();
runStoreConformance("memory (one shared store)", () => shared);

describe("memory store singleton", () => {
  afterEach(() => {
    resetStore();
    delete process.env.STORE_DRIVER;
  });

  it("returns the same instance from globalThis until reset", () => {
    const a = getMemoryStore();
    expect(getMemoryStore()).toBe(a);
    resetMemoryStore();
    expect(getMemoryStore()).not.toBe(a);
  });

  it("getStore() defaults to the memory driver and can be overridden in tests", () => {
    delete process.env.STORE_DRIVER;
    expect(storeDriver()).toBe("memory");
    expect(getStore()).toBe(getMemoryStore());
    const custom = createMemoryStore();
    setStore(custom);
    expect(getStore()).toBe(custom);
  });

  it("rejects an unknown STORE_DRIVER", () => {
    process.env.STORE_DRIVER = "postgres";
    expect(() => storeDriver()).toThrow(/STORE_DRIVER/);
  });

  it("requires DYNAMODB_TABLE for the dynamodb driver", () => {
    process.env.STORE_DRIVER = "dynamodb";
    delete process.env.DYNAMODB_TABLE;
    expect(() => getStore()).toThrow(/DYNAMODB_TABLE/);
  });
});
