import { defineConfig } from "vitest/config";

// モノレポ全体のテストをルートから一括実行する（apps/* と packages/* の src 配下）。
export default defineConfig({
  test: {
    include: ["{apps,packages}/*/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/.open-next/**", "**/dist/**"],
    passWithNoTests: true,
  },
});
