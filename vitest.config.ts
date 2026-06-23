import { defineConfig } from "vitest/config";

// モノレポ全体のテストをルートから一括実行する（apps/* と packages/* の src 配下）。
export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.{test,spec}.ts"],
    passWithNoTests: true,
  },
});
