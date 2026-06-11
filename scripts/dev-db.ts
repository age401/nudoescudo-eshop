/**
 * Starts a local PostgreSQL for development without requiring Docker or an
 * installed Postgres. Binaries are downloaded once by `embedded-postgres`.
 *
 * Usage: npm run db:dev   (keeps running; Ctrl+C to stop)
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.resolve(".local/pgdata");
const PORT = 5502;
const DB_NAME = "nudoescudo";

async function main() {
  const initialized = fs.existsSync(path.join(DATA_DIR, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: true,
  });

  if (!initialized) {
    console.log("Initializing local PostgreSQL data directory...");
    await pg.initialise();
  }

  await pg.start();

  if (!initialized) {
    // UTF8 explicitly: Windows initdb defaults to WIN1252, which cannot store
    // all card names. LOCALE 'C' is compatible with any encoding.
    const { Client } = await import("pg");
    const client = new Client({
      host: "localhost",
      port: PORT,
      user: "postgres",
      password: "postgres",
      database: "postgres",
    });
    await client.connect();
    await client.query(
      `CREATE DATABASE ${DB_NAME} TEMPLATE template0 ENCODING 'UTF8' LOCALE 'C'`,
    );
    await client.end();
    console.log(`Created database '${DB_NAME}' (UTF8).`);
  }

  console.log(
    `PostgreSQL running at postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`,
  );
  console.log("Press Ctrl+C to stop.");

  const stop = async () => {
    console.log("\nStopping PostgreSQL...");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
