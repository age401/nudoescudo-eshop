/**
 * Imports the MTG catalog (all cards + printings) from Scryfall bulk data.
 * Streams the `default_cards` file (hundreds of MB) without loading it whole.
 *
 * Idempotent: upserts by oracle_id (cards) and scryfall id (printings).
 */
import fs from "node:fs";
import { sql } from "drizzle-orm";
import StreamArray from "stream-json/streamers/StreamArray";
import { db } from "@/db";
import { cards, printings } from "@/db/schema";
import { downloadToCache, fetchJson } from "@/lib/download";
import { normalizeName, slugify } from "@/lib/normalize";
import { withSyncRun } from "@/lib/sync-runs";

type ScryfallCard = {
  id: string;
  oracle_id?: string;
  name: string;
  lang: string;
  layout: string;
  games?: string[];
  set: string;
  set_name: string;
  collector_number: string;
  rarity?: string;
  released_at?: string;
  finishes?: string[];
  image_uris?: Record<string, string>;
  card_faces?: { image_uris?: Record<string, string>; oracle_id?: string }[];
};

const EXCLUDED_LAYOUTS = new Set([
  "token",
  "double_faced_token",
  "emblem",
  "art_series",
  "scheme",
  "planar",
  "vanguard",
]);

function pickImages(c: ScryfallCard): Record<string, string> | null {
  const uris = c.image_uris ?? c.card_faces?.[0]?.image_uris;
  if (!uris) return null;
  const picked: Record<string, string> = {};
  for (const k of ["small", "normal", "large"]) if (uris[k]) picked[k] = uris[k];
  // Second face image for transform cards.
  const back = c.card_faces?.[1]?.image_uris?.normal;
  if (back) picked.back = back;
  return picked;
}

export async function syncScryfallCatalog(opts: { sets?: string[] } = {}) {
  return withSyncRun("scryfall_catalog", async () => {
    const bulk = await fetchJson<{
      data: { type: string; download_uri: string }[];
    }>("https://api.scryfall.com/bulk-data");
    const def = bulk.data.find((d) => d.type === "default_cards");
    if (!def) throw new Error("default_cards bulk entry not found");

    const file = await downloadToCache(def.download_uri, "scryfall-default-cards.json", 20);
    const setFilter = opts.sets?.length
      ? new Set(opts.sets.map((s) => s.toLowerCase()))
      : null;

    // oracle_id -> card row id, filled lazily as we encounter cards.
    const cardIdByOracle = new Map<string, string>();
    const usedSlugs = new Set<string>(
      (await db.select({ slug: cards.slug }).from(cards)).map((r) => r.slug),
    );
    const existingCards = await db
      .select({ id: cards.id, ext: cards.externalGroupId })
      .from(cards);
    for (const r of existingCards) cardIdByOracle.set(r.ext, r.id);

    let scanned = 0;
    let importedPrintings = 0;
    let newCards = 0;

    type PrintingRow = typeof printings.$inferInsert;
    let printingBatch: PrintingRow[] = [];

    async function flushPrintings() {
      if (!printingBatch.length) return;
      await db
        .insert(printings)
        .values(printingBatch)
        .onConflictDoUpdate({
          target: printings.externalId,
          set: {
            setCode: sql`excluded.set_code`,
            setName: sql`excluded.set_name`,
            collectorNumber: sql`excluded.collector_number`,
            rarity: sql`excluded.rarity`,
            lang: sql`excluded.lang`,
            imageUris: sql`excluded.image_uris`,
            finishes: sql`excluded.finishes`,
            releasedAt: sql`excluded.released_at`,
          },
        });
      importedPrintings += printingBatch.length;
      printingBatch = [];
    }

    async function ensureCard(c: ScryfallCard): Promise<string | null> {
      const oracleId = c.oracle_id ?? c.card_faces?.[0]?.oracle_id;
      if (!oracleId) return null;
      const existing = cardIdByOracle.get(oracleId);
      if (existing) return existing;

      let slug = slugify(c.name) || oracleId;
      if (usedSlugs.has(slug)) slug = `${slug}-${oracleId.slice(0, 8)}`;
      usedSlugs.add(slug);

      const [row] = await db
        .insert(cards)
        .values({
          gameId: "mtg",
          externalGroupId: oracleId,
          name: c.name,
          normalizedName: normalizeName(c.name),
          slug,
        })
        .onConflictDoUpdate({
          target: [cards.gameId, cards.externalGroupId],
          set: { name: sql`excluded.name`, normalizedName: sql`excluded.normalized_name` },
        })
        .returning({ id: cards.id });
      cardIdByOracle.set(oracleId, row.id);
      newCards++;
      return row.id;
    }

    const stream = fs.createReadStream(file).pipe(StreamArray.withParser());
    for await (const { value } of stream) {
      const c = value as ScryfallCard;
      scanned++;
      if (EXCLUDED_LAYOUTS.has(c.layout)) continue;
      if (!c.games?.includes("paper")) continue;
      if (setFilter && !setFilter.has(c.set.toLowerCase())) continue;

      const cardId = await ensureCard(c);
      if (!cardId) continue;

      printingBatch.push({
        cardId,
        externalId: c.id,
        setCode: c.set,
        setName: c.set_name,
        collectorNumber: c.collector_number,
        rarity: c.rarity ?? null,
        lang: c.lang,
        imageUris: pickImages(c),
        finishes: c.finishes ?? ["nonfoil"],
        releasedAt: c.released_at ?? null,
      });
      if (printingBatch.length >= 500) await flushPrintings();
    }
    await flushPrintings();

    return { scanned, importedPrintings, newCards };
  });
}
