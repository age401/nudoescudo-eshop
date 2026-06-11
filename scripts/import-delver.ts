/**
 * Import a Delver Lens CSV export into stock:
 *   npm run import:delver -- path/to/export.csv            (merge: adds)
 *   npm run import:delver -- path/to/export.csv --replace  (replaces stock)
 *   npm run import:delver -- path/to/export.csv --dry-run  (preview only)
 */
import fs from "node:fs";
import { loadEnv } from "../src/lib/env";

loadEnv();

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Uso: npm run import:delver -- <archivo.csv> [--replace] [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const text = fs.readFileSync(file, "utf8");
  const { previewDelverImport, applyDelverImport } = await import("../src/lib/delver-import");

  if (args.includes("--dry-run")) {
    const p = await previewDelverImport(text);
    console.log(`Filas: ${p.rows.length}, con match: ${p.matched.length}, sin match: ${p.unmatched.length}`);
    for (const u of p.unmatched.slice(0, 20)) {
      console.log(`  sin match: ${u.name ?? u.scryfallId}`);
    }
    return;
  }

  const mode = args.includes("--replace") ? "replace" : "merge";
  const result = await applyDelverImport(text, mode);
  console.log(result);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { pool } = await import("../src/db");
    await pool.end();
  });
