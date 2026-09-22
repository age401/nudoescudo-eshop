/**
 * Card condition grades.
 *
 * Conditions are an internal concern: stock is keyed by them (Delver Lens
 * exports one row per grade) but visitors never see them. The storefront
 * sells a *pool* — printing + finish + language — and checkout allocates the
 * requested quantity across the pool's grades, best first.
 */

/** Known grades, best first. */
export const CONDITION_ORDER = ["NM", "LP", "MP", "HP", "DMG"];

/** Lower is better. Unknown grades sort after every known one. */
export function conditionRank(condition: string): number {
  const i = CONDITION_ORDER.indexOf(condition.toUpperCase());
  return i === -1 ? CONDITION_ORDER.length : i;
}

/** Sort comparator: best condition first. */
export function compareCondition(a: string, b: string): number {
  return conditionRank(a) - conditionRank(b) || a.localeCompare(b);
}

/**
 * Identifies a sellable pool. This is what the cart stores and what the
 * order API receives — a stock row id would leak the grade.
 */
export function poolKey(printingId: string, finish: string, language: string): string {
  return `${printingId}|${finish}|${language}`;
}
