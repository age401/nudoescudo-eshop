/** Applies pending SQL migrations from ./drizzle. Safe to run repeatedly. */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { loadEnv, requireEnv } from "../src/lib/env";

loadEnv();

async function main() {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL"), max: 1 });
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  await pool.end();
  console.log("Migrations applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
