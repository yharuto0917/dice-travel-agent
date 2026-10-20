import { defineConfig } from "vitest/config";

// モノレポ全体のテストをルートから一括実行する（apps/* と packages/* の src 配下）。
export default defineConfig({
  plugins: [
    {
      name: "markdown-raw",
      transform(code, id) {
        if (id.endsWith(".md")) {
          return {
            code: `export default ${JSON.stringify(code)};`,
            map: null,
          };
        }
      },
    },
  ],
  test: {
    include: ["{apps,packages}/*/**/*.{test,spec}.ts"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/.open-next/**", "**/dist/**"],
    passWithNoTests: true,
  },
});
