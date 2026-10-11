import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests must not touch AWS: force the in-memory drivers.
    env: { STORE_DRIVER: "memory", PHOTOS_DRIVER: "local", LISTING_MODEL_PROVIDER: "fake" },
  },
});
