/**
 * Manual job runner:
 *   npm run sync -- catalog [--sets=neo,mid]   MTG catalog from Scryfall
 *   npm run sync -- identifiers               MTGJSON uuid mapping
 *   npm run sync -- prices                    Card Kingdom prices (MTGJSON)
 *   npm run sync -- fx                        USD->UYU rate
 *   npm run sync -- expiry                    expire stale orders
 */
import { loadEnv } from "../src/lib/env";

loadEnv();

async function main() {
  const [job, ...rest] = process.argv.slice(2);
  const setsArg = rest.find((a) => a.startsWith("--sets="));
  const sets = setsArg ? setsArg.slice("--sets=".length).split(",") : undefined;

  // Imports are deferred so loadEnv runs before the db client initializes.
  switch (job) {
    case "catalog": {
      const { syncScryfallCatalog } = await import("../src/jobs/scryfall-catalog");
      console.log(await syncScryfallCatalog({ sets }));
      break;
    }
    case "identifiers": {
      const { syncMtgjsonIdentifiers } = await import("../src/jobs/mtgjson-prices");
      console.log(await syncMtgjsonIdentifiers());
      break;
    }
    case "prices": {
      const { syncCardKingdomPrices } = await import("../src/jobs/mtgjson-prices");
      console.log(await syncCardKingdomPrices());
      break;
    }
    case "fx": {
      const { syncFxRate } = await import("../src/jobs/fx-rate");
      console.log(await syncFxRate());
      break;
    }
    case "expiry": {
      const { expireStaleOrders } = await import("../src/jobs/order-expiry");
      console.log(await expireStaleOrders());
      break;
    }
    case "pokemon-catalog": {
      const { syncPokemonCatalog } = await import("../src/jobs/pokemon-catalog");
      console.log(await syncPokemonCatalog());
      break;
    }
    case "pokemon-prices": {
      const { syncPokemonPrices } = await import("../src/jobs/pokemon-prices");
      console.log(await syncPokemonPrices());
      break;
    }
    default:
      console.error(
        "Usage: npm run sync -- <catalog|identifiers|prices|fx|expiry|pokemon-catalog|pokemon-prices> [--sets=a,b]",
      );
      process.exitCode = 1;
      return;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Close the pg pool so the process can exit cleanly.
    const { pool } = await import("../src/db");
    await pool.end();
  });
