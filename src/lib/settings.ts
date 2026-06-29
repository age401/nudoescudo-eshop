import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";

export async function getSetting<T>(key: string): Promise<T | null> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, key) });
  return (row?.value as T) ?? null;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date() },
    });
}

export type FxRate = { rate: number; updatedAt: string };

export async function getPricingContext(): Promise<{
  multiplier: number;
  fxRate: number | null;
  minimumUsd: number;
}> {
  const [multiplier, fx, minimum] = await Promise.all([
    getSetting<number>("price_multiplier"),
    getSetting<FxRate>("fx_rate_uyu_per_usd"),
    getSetting<number>("min_price_usd"),
  ]);
  return {
    multiplier: multiplier ?? 1,
    fxRate: fx?.rate ?? null,
    minimumUsd: minimum ?? 0,
  };
}
