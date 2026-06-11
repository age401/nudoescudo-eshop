/**
 * Price logic: the shop sells at (Card Kingdom reference price × multiplier),
 * unless a stock row has a manual override. UYU is informative, derived from
 * the daily exchange rate.
 */

export function computeUnitPriceUsd(args: {
  referenceUsd: number | null;
  overrideUsd: number | null;
  multiplier: number;
}): number | null {
  if (args.overrideUsd != null) return round2(args.overrideUsd);
  if (args.referenceUsd == null) return null;
  return round2(args.referenceUsd * args.multiplier);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function usdToUyu(usd: number, fxRate: number): number {
  // Round UYU to whole pesos — cents are not used in practice.
  return Math.round(usd * fxRate);
}

const usdFmt = new Intl.NumberFormat("es-UY", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const uyuFmt = new Intl.NumberFormat("es-UY", { maximumFractionDigits: 0 });

export function formatUsd(n: number): string {
  return `US$ ${usdFmt.format(n)}`;
}

export function formatUyu(n: number): string {
  return `$U ${uyuFmt.format(n)}`;
}
