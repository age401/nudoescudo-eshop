/** Seeds reference data (games, default settings). Idempotent. */
import { db, pool } from "../src/db";
import { games, settings } from "../src/db/schema";

async function main() {
  await db
    .insert(games)
    .values([
      { id: "mtg", name: "Magic: The Gathering", enabled: true, sortOrder: 0 },
      { id: "pokemon", name: "Pokémon", enabled: false, sortOrder: 1 },
    ])
    .onConflictDoNothing();

  await db
    .insert(settings)
    .values([
      { key: "price_multiplier", value: 1.0 },
      { key: "min_price_usd", value: 0 },
      { key: "reservation_ttl_hours", value: 24 },
    ])
    .onConflictDoNothing();

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
