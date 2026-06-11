import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { loadEnv, requireEnv } from "@/lib/env";

loadEnv();

declare global {
  // Reuse the pool across Next.js hot reloads in dev.
  var __nudoPool: Pool | undefined;
}

const pool =
  globalThis.__nudoPool ??
  new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 10 });

if (process.env.NODE_ENV !== "production") globalThis.__nudoPool = pool;

export const db = drizzle(pool, { schema });
export { schema, pool };
