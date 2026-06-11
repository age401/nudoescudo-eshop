import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isAdmin } from "@/lib/admin-auth";
import { normalizeName } from "@/lib/normalize";

/** Admin-only printing search for the manual stock-add form. */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = normalizeName(req.nextUrl.searchParams.get("q") ?? "");
  if (q.length < 2) return NextResponse.json([]);

  const rows = await db.execute(sql`
    select p.id as printing_id, c.name as card_name, c.game_id,
           p.set_name, p.collector_number, p.finishes
    from printings p
    join cards c on c.id = p.card_id
    where c.normalized_name like ${"%" + q + "%"}
    order by c.normalized_name, p.released_at desc nulls last
    limit 25
  `);
  return NextResponse.json(rows.rows);
}
