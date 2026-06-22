import path from "node:path";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  // モノレポのため Turbopack のルートを明示（他のlockfile誤検出による警告を抑制）。
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  transpilePackages: ["@repo/shared"],
};

export default nextConfig;
