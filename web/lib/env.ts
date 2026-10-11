/**
 * Environment values shared by more than one module. Module-specific
 * variables are read inside their own module (see docs/ARCHITECTURE.md).
 */

/**
 * AWS region for every AWS SDK client: APP_AWS_REGION, falling back to
 * AWS_REGION. Amplify Hosting reserves the AWS_ prefix for variables users
 * set, so deployments set APP_AWS_REGION. undefined lets the SDK use its own
 * default chain.
 */
export function awsRegion(): string | undefined {
  const value = process.env.APP_AWS_REGION?.trim() || process.env.AWS_REGION?.trim();
  return value || undefined;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
