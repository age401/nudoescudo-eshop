/**
 * Card Kingdom retail price sync.
 *
 * Card Kingdom has no public API; MTGJSON republishes its retail prices daily:
 *  - AllIdentifiers.json.gz : MTGJSON uuid -> identifiers (incl. scryfallId).
 *    Refreshed weekly into the mtgjson_map table.
 *  - AllPricesToday.json.gz : uuid -> paper.cardkingdom.retail.{normal,foil}.
 *    Applied nightly to the prices table (finish: normal->nonfoil).
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import { chain } from "stream-chain";
import { parser } from "stream-json";
import { pick } from "stream-json/filters/Pick";
import { streamObject } from "stream-json/streamers/StreamObject";
import { db } from "@/db";
import { mtgjsonMap, prices, printings } from "@/db/schema";
import { downloadToCache } from "@/lib/download";
import { withSyncRun } from "@/lib/sync-runs";

/** Streams `{ key, value }` entries of the top-level "data" object. */
function dataEntries(file: string) {
  return chain([
    fs.createReadStream(file),
    parser(),
    pick({ filter: "data" }),
    streamObject(),
  ]);
}

const IDENTIFIERS_URL = "https://mtgjson.com/api/v5/AllIdentifiers.json.gz";
const PRICES_URL = "https://mtgjson.com/api/v5/AllPricesToday.json.gz";

/** Refresh the uuid -> scryfallId mapping (weekly; file is large). */
export async function syncMtgjsonIdentifiers() {
  return withSyncRun("mtgjson_identifiers", async () => {
    const file = await downloadToCache(IDENTIFIERS_URL, "mtgjson-identifiers.json", 24 * 6);

    let mapped = 0;
    let batch: { uuid: string; scryfallId: string }[] = [];

    async function flush() {
      if (!batch.length) return;
      await db
        .insert(mtgjsonMap)
        .values(batch)
        .onConflictDoUpdate({
          target: mtgjsonMap.uuid,
          set: { scryfallId: sql`excluded.scryfall_id` },
        });
      mapped += batch.length;
      batch = [];
    }

    // File shape: { meta: {...}, data: { [uuid]: { identifiers: {...} } } }
    for await (const { key, value } of dataEntries(file)) {
      const scryfallId = (value as { identifiers?: { scryfallId?: string } })
        ?.identifiers?.scryfallId;
      if (!scryfallId) continue;
      batch.push({ uuid: key as string, scryfallId });
      if (batch.length >= 1000) await flush();
    }
    await flush();
    return { mapped };
  });
}

type TodayPricePoints = Record<string, number>; // { 'YYYY-MM-DD': price }
type PaperPrices = {
  paper?: {
    cardkingdom?: {
      retail?: { normal?: TodayPricePoints; foil?: TodayPricePoints; etched?: TodayPricePoints };
    };
  };
};

function latest(points?: TodayPricePoints): number | null {
  if (!points) return null;
  const dates = Object.keys(points).sort();
  const last = dates[dates.length - 1];
  return last ? points[last] : null;
}

/** Apply today's Card Kingdom retail prices (nightly). */
export async function syncCardKingdomPrices() {
  return withSyncRun("mtgjson_prices", async () => {
    // Mapping must exist first; refresh it if the table is empty/stale.
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(mtgjsonMap);
    if (count === 0) await syncMtgjsonIdentifiers();

    // Only printings we actually have in the catalog get price rows.
    const known = new Map<string, string>(); // scryfallId -> printingId
    for (const r of await db
      .select({ id: printings.id, ext: printings.externalId })
      .from(printings)) {
      known.set(r.ext, r.id);
    }
    const uuidToScryfall = new Map<string, string>();
    for (const r of await db.select().from(mtgjsonMap)) {
      uuidToScryfall.set(r.uuid, r.scryfallId);
    }

    const file = await downloadToCache(PRICES_URL, "mtgjson-prices-today.json", 12);

    let updated = 0;
    type PriceRow = typeof prices.$inferInsert;
    let batch: PriceRow[] = [];

    async function flush() {
      if (!batch.length) return;
      await db
        .insert(prices)
        .values(batch)
        .onConflictDoUpdate({
          target: [prices.printingId, prices.finish],
          set: {
            priceUsd: sql`excluded.price_usd`,
            source: sql`excluded.source`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      updated += batch.length;
      batch = [];
    }

    const now = new Date();
    for await (const { key, value } of dataEntries(file)) {
      const scryfallId = uuidToScryfall.get(key as string);
      if (!scryfallId) continue;
      const printingId = known.get(scryfallId);
      if (!printingId) continue;

      const retail = (value as PaperPrices).paper?.cardkingdom?.retail;
      if (!retail) continue;

      const finishes: [string, number | null][] = [
        ["nonfoil", latest(retail.normal)],
        ["foil", latest(retail.foil)],
        ["etched", latest(retail.etched)],
      ];
      for (const [finish, price] of finishes) {
        if (price == null) continue;
        batch.push({
          printingId,
          finish,
          source: "cardkingdom",
          priceUsd: price.toFixed(2),
          updatedAt: now,
        });
      }
      if (batch.length >= 1000) await flush();
    }
    await flush();
    return { updated };
  });
}
