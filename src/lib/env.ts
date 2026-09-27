import fs from "node:fs";
import path from "node:path";

let loaded = false;

/**
 * Load .env into process.env for non-Next entrypoints (scripts, worker,
 * drizzle-kit). Next.js loads .env itself. Existing env vars win.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const file of [".env.local", ".env"]) {
    // Runtime-only lookups: the ignore hints stop Turbopack's file tracing
    // (NFT) from treating cwd as a dependency and tracing the whole project.
    const p = path.resolve(/*turbopackIgnore: true*/ process.cwd(), file);
    if (!fs.existsSync(/*turbopackIgnore: true*/ p)) continue;
    try {
      process.loadEnvFile(/*turbopackIgnore: true*/ p);
    } catch {
      // ignore malformed lines / missing file races
    }
  }
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
