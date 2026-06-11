/** Daily USD -> UYU exchange rate, stored in settings. */
import { fetchJson } from "@/lib/download";
import { setSetting } from "@/lib/settings";
import { withSyncRun } from "@/lib/sync-runs";

const FX_URL = "https://open.er-api.com/v6/latest/USD";

export async function syncFxRate() {
  return withSyncRun("fx_rate", async () => {
    const data = await fetchJson<{ result: string; rates?: Record<string, number> }>(
      FX_URL,
    );
    const rate = data.rates?.UYU;
    if (data.result !== "success" || !rate) {
      throw new Error(`FX API returned no UYU rate (result=${data.result})`);
    }
    await setSetting("fx_rate_uyu_per_usd", {
      rate,
      updatedAt: new Date().toISOString(),
    });
    return { rate };
  });
}
