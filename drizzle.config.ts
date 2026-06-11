import { defineConfig } from "drizzle-kit";
import { loadEnv, requireEnv } from "./src/lib/env";

loadEnv();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: requireEnv("DATABASE_URL") },
});
