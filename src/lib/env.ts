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
    const p = path.resolve(process.cwd(), file);
    if (!fs.existsSync(p)) continue;
    try {
      process.loadEnvFile(p);
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
