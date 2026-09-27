import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { toCsv } from "@/lib/csv";
import { computeUnitPriceUsd } from "@/lib/pricing";
import { getPricingContext } from "@/lib/settings";
import { allStock, parseStockFilters } from "@/lib/stock-query";

/**
 * Admin-only stock download, honoring the stock table's filters.
 *
 * Column names are picked so the file can be fed back to the Delver import
 * (it finds columns by name, and takes the first one containing "name" — so
 * Name must come before Set Name). That makes it a portable stock backup too.
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const filters = parseStockFilters(Object.fromEntries(req.nextUrl.searchParams));
  const { multiplier, minimumUsd } = await getPricingContext();
  const rows = await allStock(filters, multiplier);

  const csv = toCsv(
    [
      "Name",
      "Game",
      "Set Code",
      "Set Name",
      "Collector Number",
      "Foil",
      "Condition",
      "Language",
      "Quantity",
      "Reserved",
      "Available",
      "Sale Price USD",
      "Manual Price USD",
      "Reference Price USD",
      "Scryfall ID",
    ],
    rows.map((r) => {
      const override = r.price_override_usd != null ? Number(r.price_override_usd) : null;
      const reference = r.reference_usd != null ? Number(r.reference_usd) : null;
      const sale = computeUnitPriceUsd({ referenceUsd: reference, overrideUsd: override, multiplier, minimumUsd });
      return [
        r.card_name,
        r.game_id,
        r.set_code.toUpperCase(),
        r.set_name,
        r.collector_number,
        r.finish === "nonfoil" ? "" : r.finish,
        r.condition,
        r.language,
        r.quantity,
        r.reserved,
        r.quantity - r.reserved,
        sale != null ? sale.toFixed(2) : "",
        override != null ? override.toFixed(2) : "",
        reference != null ? reference.toFixed(2) : "",
        // Only Magic printings carry a Scryfall id.
        r.game_id === "mtg" ? r.external_id : "",
      ];
    }),
  );

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="stock-nudoescudo-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
