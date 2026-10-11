/**
 * Server start checks (Node.js runtime only; called from instrumentation.ts).
 */
import { assertStartupConfig } from "@/lib/config";

/**
 * Log the driver configuration. In production, exit the process when it is
 * broken: a server that cannot reach its data store or model should not take
 * requests. Outside production problems are logged and the server keeps running.
 */
export function checkStartupConfig(): void {
  try {
    assertStartupConfig();
  } catch (error) {
    console.error(`[config] ${error instanceof Error ? error.message : String(error)}`);
    console.error("[config] Stopping: fix the configuration and start the server again.");
    process.exit(1);
  }
}
