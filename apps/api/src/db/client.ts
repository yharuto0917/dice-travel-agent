import { drizzle } from "drizzle-orm/d1";
import type { Bindings } from "../env";
import * as schema from "./schema";

/** D1 バインディングから drizzle クライアントを生成する。 */
export function getDb(env: Bindings) {
  return drizzle(env.DB, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
