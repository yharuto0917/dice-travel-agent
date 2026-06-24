import { zValidator } from "@hono/zod-validator";
import { CreatePlanRequestSchema } from "@repo/shared";
import { Hono } from "hono";
import { getDb } from "../db/client";
import { plans } from "../db/schema";
import type { AppEnv } from "../env";

const plansRoute = new Hono<AppEnv>();

plansRoute.post("/", zValidator("json", CreatePlanRequestSchema), async (c) => {
  const db = getDb(c.env);
  const body = c.req.valid("json");
  const clientId = c.get("clientId");

  const planId = crypto.randomUUID();

  await db.insert(plans).values({
    id: planId,
    clientId,
    status: "draft",
    destinationPrefCode: body.destinationPrefCode,
    destinationPref: body.destinationPref,
    conditions: body.conditions,
  });

  return c.json({ id: planId });
});

export default plansRoute;
