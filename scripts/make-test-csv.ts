/** Dev helper: fabricate a Delver-Lens-style CSV from the imported catalog. */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { loadEnv } from "../src/lib/env";

loadEnv();

async function main() {
  const { db, pool } = await import("../src/db");
  const rows = await db.execute(sql`
    select p.external_id, c.name, p.set_name, p.finishes
    from printings p
    join cards c on c.id = p.card_id
    join prices pr on pr.printing_id = p.id and pr.finish = 'nonfoil'
    where p.image_uris is not null
    order by pr.price_usd::numeric desc
    limit 14
  `);
  const conditions = ["Near Mint", "Near Mint", "Lightly Played", "Moderately Played"];
  const langs = ["English", "English", "English", "Spanish"];
  const lines = ["Quantity,Name,Set,Scryfall ID,Foil,Condition,Language"];
  (rows.rows as Record<string, unknown>[]).forEach((r, i) => {
    const qty = (i % 4) + 1;
    const finishes = r.finishes as string[];
    lines.push(
      `${qty},"${r.name}","${r.set_name}",${r.external_id},,${conditions[i % 4]},${langs[i % 4]}`,
    );
    if (finishes.includes("foil") && i % 3 === 0) {
      lines.push(
        `1,"${r.name}","${r.set_name}",${r.external_id},Foil,Near Mint,English`,
      );
    }
  });
  fs.mkdirSync(".local", { recursive: true });
  fs.writeFileSync(".local/test-delver.csv", lines.join("\n"), "utf8");
  console.log(`Wrote .local/test-delver.csv (${lines.length - 1} rows)`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
