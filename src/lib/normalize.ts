/**
 * Text normalization shared by the catalog importers and the search endpoint.
 * Search compares normalized-to-normalized, so both sides must use this.
 */

/** Lowercase, strip diacritics, unify punctuation/whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining accents
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/œ/g, "oe")
    .replace(/['’´`]/g, "")
    .replace(/[^a-z0-9/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** URL slug from a card name (unique per game with a suffix on collision). */
export function slugify(name: string): string {
  return normalizeName(name).replace(/[/\s]+/g, "-").replace(/^-+|-+$/g, "");
}
