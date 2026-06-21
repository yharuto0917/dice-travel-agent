import { Hono } from "hono";
import { type User } from "@repo/shared";

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.get("/user/:id", (c) => {
  const id = c.req.param("id");
  const user: User = { id, name: "haruto" };
  return c.json(user);
})

export type AppType = typeof app;
export default app;
