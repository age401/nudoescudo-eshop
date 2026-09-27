import { redirect } from "next/navigation";

/**
 * The old "sold — remove from Delver" report. Stock now lives on the site, so
 * there is nothing to reconcile; sales show up in the stock movements.
 */
export default function RetiredDelverReport() {
  redirect("/admin/stock/movimientos");
}
