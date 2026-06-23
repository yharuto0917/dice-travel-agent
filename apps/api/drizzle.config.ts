import { defineConfig } from "drizzle-kit";

// マイグレーションは drizzle-kit generate でファイル生成し、
// wrangler d1 migrations apply で適用する（drizzle-kit push は使わない）。
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
