import { z } from "zod";

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export type User = z.infer<typeof UserSchema>;

export * from "./data/prefecture-centroids";
export * from "./schemas/agent";
export * from "./schemas/api-dto";
export * from "./schemas/common";
export * from "./schemas/conditions";
export * from "./schemas/destination";
export * from "./schemas/dice";
export * from "./schemas/plan";
