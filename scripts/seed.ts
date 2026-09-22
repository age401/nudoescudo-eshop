/**
 * Seeds reference data (games, default settings). Idempotent.
 *
 * `games` is deliberately upserted rather than left alone: the `enabled`
 * flag here decides what the storefront sells, so flipping a game on or off
 * is a one-line change that takes effect on the next deploy.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db";
import { games, settings } from "../src/db/schema";

async function main() {
  await db
    .insert(games)
    .values([
      { id: "mtg", name: "Magic: The Gathering", enabled: true, sortOrder: 0 },
      // Pokemon is catalogued but not for sale yet — flip to true to launch it.
      { id: "pokemon", name: "Pokémon", enabled: false, sortOrder: 1 },
    ])
    .onConflictDoUpdate({
      target: games.id,
      set: {
        name: sql`excluded.name`,
        enabled: sql`excluded.enabled`,
        sortOrder: sql`excluded.sort_order`,
      },
    });

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
