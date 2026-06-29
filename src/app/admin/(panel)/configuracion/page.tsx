import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-auth";
import { M } from "@/lib/messages";
import { getSetting, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.settings.title} — ${M.storeName}` };

async function saveAction(formData: FormData) {
  "use server";
  await requireAdmin();
  const multiplier = Number(String(formData.get("multiplier")).replace(",", "."));
  const minPrice = Number(String(formData.get("minPrice")).replace(",", "."));
  const ttl = parseInt(String(formData.get("ttl")), 10);
  if (Number.isFinite(multiplier) && multiplier > 0 && multiplier < 10) {
    await setSetting("price_multiplier", multiplier);
  }
  if (Number.isFinite(minPrice) && minPrice >= 0 && minPrice < 100000) {
    await setSetting("min_price_usd", minPrice);
  }
  if (Number.isFinite(ttl) && ttl >= 1 && ttl <= 168) {
    await setSetting("reservation_ttl_hours", ttl);
  }
  revalidatePath("/admin/configuracion");
  redirect("/admin/configuracion?ok=1");
}

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string }>;
}) {
  const { ok } = await searchParams;
  const S = M.admin.settings;
  const multiplier = (await getSetting<number>("price_multiplier")) ?? 1;
  const minPrice = (await getSetting<number>("min_price_usd")) ?? 0;
  const ttl = (await getSetting<number>("reservation_ttl_hours")) ?? 24;

  return (
    <div className="max-w-xl">
      <h2 className="font-display text-lg font-semibold">{S.title}</h2>
      {ok && (
        <p className="mt-3 rounded-lg bg-felt/10 px-4 py-2 text-sm font-medium text-felt">
          {S.saved}
        </p>
      )}
      <form action={saveAction} className="mt-4 space-y-6 rounded-xl border border-ink/10 bg-white p-6">
        <label className="block">
          <span className="text-sm font-semibold">{S.multiplier}</span>
          <input
            type="number"
            name="multiplier"
            step="0.01"
            min="0.1"
            max="9.99"
            defaultValue={multiplier}
            className="font-price mt-1 w-32 rounded-lg border border-ink/15 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-ink-faint">{S.multiplierHelp}</span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold">{S.minPrice}</span>
          <input
            type="number"
            name="minPrice"
            step="0.01"
            min="0"
            max="99999"
            defaultValue={minPrice}
            className="font-price mt-1 w-32 rounded-lg border border-ink/15 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-ink-faint">{S.minPriceHelp}</span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold">{S.ttl}</span>
          <input
            type="number"
            name="ttl"
            min="1"
            max="168"
            defaultValue={ttl}
            className="font-price mt-1 w-32 rounded-lg border border-ink/15 px-3 py-2"
          />
          <span className="mt-1 block text-xs text-ink-faint">{S.ttlHelp}</span>
        </label>
        <button
          type="submit"
          className="rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper hover:bg-felt-soft"
        >
          {S.save}
        </button>
      </form>
    </div>
  );
}
