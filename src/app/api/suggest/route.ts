import { NextRequest, NextResponse } from "next/server";
import { suggestCards } from "@/lib/catalog";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (q.trim().length < 2) return NextResponse.json([]);
  const results = await suggestCards(q);
  return NextResponse.json(results, {
    headers: { "Cache-Control": "public, max-age=30" },
  });
}
