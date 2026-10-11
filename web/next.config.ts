import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Separate build dirs let several dev servers run in one checkout (NEXT_DIST_DIR=.next-xyz).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // NEXT_OUTPUT=standalone builds the self-contained server used by the Dockerfile (App Runner fallback).
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
};

export default nextConfig;
