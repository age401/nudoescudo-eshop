/**
 * Pokemon price sync (TCGplayer USD market prices via TCGdex).
 *
 * Only stocked printings are priced — a handful of per-card requests nightly
 * instead of crawling the whole catalog.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { prices } from "@/db/schema";
import { fetchJson } from "@/lib/download";
import { withSyncRun } from "@/lib/sync-runs";

const API = "https://api.tcgdex.net/v2/en";

type CardDetail = {
  pricing?: {
    tcgplayer?: Record<
      string,
      { marketPrice?: number | null; midPrice?: number | null } | string | undefined
    >;
  };
};

/** TCGdex/TCGplayer variant key -> our finish vocabulary. */
const VARIANT_FINISH: Record<string, string> = {
  normal: "nonfoil",
  holofoil: "foil",
  "reverse-holofoil": "reverse",
  "1st-edition-holofoil": "foil",
  "1st-edition": "nonfoil",
};

export async function syncPokemonPrices() {
  return withSyncRun("pokemon_prices", async () => {
    const stocked = (
      await db.execute(sql`
        select distinct p.id as printing_id, p.external_id
        from printings p
        join cards c on c.id = p.card_id and c.game_id = 'pokemon'
        join stock s on s.printing_id = p.id
        where s.quantity > 0
      `)
    ).rows as { printing_id: string; external_id: string }[];

    let updated = 0;
    let missing = 0;

    for (const row of stocked) {
      const tcgdexId = row.external_id.replace(/^tcgdex:/, "");
      let detail: CardDetail;
      try {
        detail = await fetchJson<CardDetail>(`${API}/cards/${tcgdexId}`);
      } catch {
        missing++;
        continue;
      }
      const tp = detail.pricing?.tcgplayer;
      if (!tp) {
        missing++;
        continue;
      }
      const now = new Date();
      for (const [variant, data] of Object.entries(tp)) {
        const finish = VARIANT_FINISH[variant];
        if (!finish || typeof data !== "object" || !data) continue;
        const price = data.marketPrice ?? data.midPrice;
        if (price == null || price <= 0) continue;
        await db
          .insert(prices)
          .values({
            printingId: row.printing_id,
            finish,
            source: "tcgplayer",
            priceUsd: price.toFixed(2),
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [prices.printingId, prices.finish],
            set: {
              priceUsd: price.toFixed(2),
              source: "tcgplayer",
              updatedAt: now,
            },
          });
        updated++;
      }
      // Be polite with the free API.
      await new Promise((r) => setTimeout(r, 150));
    }

    return { stockedPrintings: stocked.length, updated, missing };
  });
}
