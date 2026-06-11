/**
 * Pokemon catalog import from TCGdex (free, open source).
 *
 * Card briefs come from each set's detail endpoint (one request per set,
 * ~200 sets). Cards are grouped into canonical `cards` rows by exact name —
 * Pokemon has no oracle-style identity, and players search by name.
 *
 * Variant availability (normal/reverse/holo) is only in per-card details, so
 * printings get the full finish vocabulary; what's actually sellable is
 * defined by the stock rows the admin creates.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, games, printings } from "@/db/schema";
import { fetchJson } from "@/lib/download";
import { normalizeName, slugify } from "@/lib/normalize";
import { withSyncRun } from "@/lib/sync-runs";

const API = "https://api.tcgdex.net/v2/en";

type SetBrief = { id: string; name: string };
type SetDetail = {
  id: string;
  name: string;
  releaseDate?: string;
  cards: { id: string; localId: string; name: string; image?: string }[];
};

export async function syncPokemonCatalog() {
  return withSyncRun("pokemon_catalog", async () => {
    const sets = await fetchJson<SetBrief[]>(`${API}/sets`);

    // name-key -> card row id
    const cardIdByName = new Map<string, string>();
    const existing = await db
      .select({ id: cards.id, ext: cards.externalGroupId })
      .from(cards)
      .where(sql`${cards.gameId} = 'pokemon'`);
    for (const r of existing) cardIdByName.set(r.ext, r.id);
    const usedSlugs = new Set<string>(
      (
        await db
          .select({ slug: cards.slug })
          .from(cards)
          .where(sql`${cards.gameId} = 'pokemon'`)
      ).map((r) => r.slug),
    );

    let importedPrintings = 0;
    let newCards = 0;
    let failedSets = 0;

    for (const setBrief of sets) {
      let set: SetDetail;
      try {
        set = await fetchJson<SetDetail>(`${API}/sets/${setBrief.id}`);
      } catch {
        failedSets++;
        continue;
      }

      type PrintingRow = typeof printings.$inferInsert;
      const batch: PrintingRow[] = [];

      for (const c of set.cards) {
        if (!c.name) continue;
        const nameKey = `name:${normalizeName(c.name)}`;
        let cardId = cardIdByName.get(nameKey);
        if (!cardId) {
          let slug = slugify(c.name) || c.id;
          if (usedSlugs.has(slug)) slug = `${slug}-${c.id.toLowerCase()}`;
          usedSlugs.add(slug);
          const [row] = await db
            .insert(cards)
            .values({
              gameId: "pokemon",
              externalGroupId: nameKey,
              name: c.name,
              normalizedName: normalizeName(c.name),
              slug,
            })
            .onConflictDoUpdate({
              target: [cards.gameId, cards.externalGroupId],
              set: { name: sql`excluded.name` },
            })
            .returning({ id: cards.id });
          cardId = row.id;
          cardIdByName.set(nameKey, cardId);
          newCards++;
        }

        batch.push({
          cardId,
          externalId: `tcgdex:${c.id}`,
          setCode: set.id,
          setName: set.name,
          collectorNumber: c.localId,
          lang: "en",
          imageUris: c.image
            ? { small: `${c.image}/low.webp`, normal: `${c.image}/high.webp` }
            : null,
          finishes: ["nonfoil", "reverse", "foil"],
          releasedAt: set.releaseDate ?? null,
        });
      }

      if (batch.length) {
        await db
          .insert(printings)
          .values(batch)
          .onConflictDoUpdate({
            target: printings.externalId,
            set: {
              setName: sql`excluded.set_name`,
              collectorNumber: sql`excluded.collector_number`,
              imageUris: sql`excluded.image_uris`,
              releasedAt: sql`excluded.released_at`,
            },
          });
        importedPrintings += batch.length;
      }
    }

    // Make the game visible in search once there is catalog data.
    if (importedPrintings > 0) {
      await db.update(games).set({ enabled: true }).where(sql`${games.id} = 'pokemon'`);
    }

    return { sets: sets.length, failedSets, importedPrintings, newCards };
  });
}
