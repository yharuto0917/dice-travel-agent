import type { User } from "@repo/shared";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb, schema } from "./db/client";
import { type AppEnv, authMiddleware } from "./middleware/auth";

const app = new Hono<AppEnv>();

app.get("/health", (c) => c.json({ ok: true }));

app.get("/user/:id", (c) => {
  const id = c.req.param("id");
  const user: User = { id, name: "haruto" };
  return c.json(user);
});

// 認証必須。検証済みトークンから uid を解決し、users を upsert して返す。
app.get("/me", authMiddleware, async (c) => {
  const user = c.get("user");
  const db = getDb(c.env);
  await db
    .insert(schema.users)
    .values({ id: user.uid, email: user.email })
    .onConflictDoUpdate({
      target: schema.users.id,
      set: { email: user.email, updatedAt: sql`(CURRENT_TIMESTAMP)` },
    });
  return c.json({ uid: user.uid, email: user.email });
});

export type AppType = typeof app;
export default app;
