/** Dev helper: print orders and reserved stock to verify flows. */
import { sql } from "drizzle-orm";
import { loadEnv } from "../src/lib/env";

loadEnv();

async function main() {
  const { db, pool } = await import("../src/db");
  const orders = await db.execute(sql`
    select public_code, status, email, total_usd, total_uyu, reservation_expires_at
    from orders order by created_at desc limit 10`);
  console.log("ORDERS:", orders.rows);
  const reserved = await db.execute(sql`
    select c.name, s.finish, s.condition, s.quantity, s.reserved
    from stock s
    join printings p on p.id = s.printing_id
    join cards c on c.id = p.card_id
    where s.reserved > 0`);
  console.log("RESERVED STOCK:", reserved.rows);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
