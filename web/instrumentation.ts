/**
 * Runs once when the server starts (Next.js instrumentation hook).
 *
 * Checks the driver configuration (lib/config.ts, through lib/startup.ts). In
 * production a missing required variable (DYNAMODB_TABLE, PHOTOS_BUCKET,
 * LISTING_MODEL_ID for the AWS drivers, which are the production defaults)
 * stops the server here with a message naming it, instead of failing on the
 * first request. Outside production the problems are only logged.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { checkStartupConfig } = await import("./lib/startup");
    checkStartupConfig();
  }
}
