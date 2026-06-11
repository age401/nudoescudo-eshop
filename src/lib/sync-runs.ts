import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncRuns } from "@/db/schema";

/**
 * Wraps a background job with sync_runs bookkeeping so every execution is
 * visible in the admin dashboard.
 */
export async function withSyncRun<T extends Record<string, unknown>>(
  job: string,
  fn: () => Promise<T>,
): Promise<T> {
  const [run] = await db.insert(syncRuns).values({ job }).returning();
  try {
    const stats = await fn();
    await db
      .update(syncRuns)
      .set({ status: "success", finishedAt: new Date(), stats })
      .where(eq(syncRuns.id, run.id));
    return stats;
  } catch (err) {
    await db
      .update(syncRuns)
      .set({
        status: "error",
        finishedAt: new Date(),
        message: err instanceof Error ? err.message : String(err),
      })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}
