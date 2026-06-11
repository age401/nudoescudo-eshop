/**
 * Background worker: schedules all recurring maintenance so the shop needs no
 * manual upkeep. Runs as its own container/process alongside the web app.
 *
 * Schedules (server local time, set TZ=America/Montevideo in production):
 *  - every 15 min : expire unconfirmed orders (release reservations)
 *  - daily 07:10  : USD->UYU exchange rate
 *  - daily 07:30  : Card Kingdom prices (MTGJSON publishes overnight US time)
 *  - weekly Sun 06:00 : Scryfall catalog refresh (new sets/printings)
 *  - weekly Sun 05:00 : MTGJSON identifier mapping refresh
 */
import cron from "node-cron";
import { loadEnv } from "../src/lib/env";

loadEnv();

async function safely(name: string, fn: () => Promise<unknown>) {
  try {
    console.log(`[worker] ${name}: starting`);
    const stats = await fn();
    console.log(`[worker] ${name}: done`, stats);
  } catch (err) {
    // withSyncRun already recorded the failure for the admin panel.
    console.error(`[worker] ${name}: FAILED`, err);
  }
}

async function main() {
  const { expireStaleOrders } = await import("../src/jobs/order-expiry");
  const { syncFxRate } = await import("../src/jobs/fx-rate");
  const { syncCardKingdomPrices, syncMtgjsonIdentifiers } = await import(
    "../src/jobs/mtgjson-prices"
  );
  const { syncScryfallCatalog } = await import("../src/jobs/scryfall-catalog");
  const { syncPokemonCatalog } = await import("../src/jobs/pokemon-catalog");
  const { syncPokemonPrices } = await import("../src/jobs/pokemon-prices");
  const { getSetting } = await import("../src/lib/settings");

  cron.schedule("*/15 * * * *", () => safely("order_expiry", expireStaleOrders));
  cron.schedule("10 7 * * *", () => safely("fx_rate", syncFxRate));
  cron.schedule("30 7 * * *", () => safely("ck_prices", syncCardKingdomPrices));
  cron.schedule("50 7 * * *", () => safely("pokemon_prices", syncPokemonPrices));
  cron.schedule("0 5 * * 0", () => safely("mtgjson_identifiers", syncMtgjsonIdentifiers));
  cron.schedule("0 6 * * 0", () => safely("scryfall_catalog", () => syncScryfallCatalog()));
  cron.schedule("0 8 * * 0", () => safely("pokemon_catalog", syncPokemonCatalog));

  console.log("[worker] schedules registered");

  // On boot: make sure an FX rate exists so prices in UYU can be shown.
  const fx = await getSetting("fx_rate_uyu_per_usd");
  if (!fx) await safely("fx_rate (boot)", syncFxRate);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
