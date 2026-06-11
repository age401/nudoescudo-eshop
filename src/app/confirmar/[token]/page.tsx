import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderItems } from "@/db/schema";
import { adminNewOrderEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { M } from "@/lib/messages";
import { confirmOrder } from "@/lib/orders";
import { formatUsd, formatUyu } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function ConfirmPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await confirmOrder(token);

  if (result.status === "confirmed") {
    // Notify the shop (email + the order shows as new in the admin panel).
    try {
      const items = await db
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, result.order.id));
      const mail = adminNewOrderEmail(
        result.order,
        items,
        env("SITE_URL", "http://localhost:3000"),
      );
      await sendMail({ to: env("ADMIN_EMAIL", "admin@localhost"), ...mail });
    } catch (err) {
      console.error("Failed to notify admin", err);
    }
  }

  const ok = result.status === "confirmed" || result.status === "already_confirmed";

  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      {ok ? (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-felt text-3xl text-paper">
            ✓
          </div>
          <h1 className="font-display mt-6 text-3xl font-semibold">
            {M.orderStatus.confirmedTitle}
          </h1>
          <p className="mt-3 text-ink-soft">
            {result.status === "already_confirmed"
              ? M.orderStatus.alreadyConfirmed
              : M.orderStatus.confirmedBody}
          </p>
          <p className="font-price mt-6 inline-block rounded-lg bg-paper-dim px-4 py-2 text-sm">
            {M.orderStatus.orderCode}:{" "}
            <strong>{result.order.publicCode}</strong>
          </p>
          <p className="font-price mt-2 text-lg font-semibold text-felt">
            {formatUsd(Number(result.order.totalUsd))}
            {result.order.totalUyu && (
              <span className="ml-2 font-normal text-ink-faint">
                ≈ {formatUyu(Number(result.order.totalUyu))}
              </span>
            )}
          </p>
        </>
      ) : (
        <>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-paper-dim text-3xl text-ink-faint">
            ?
          </div>
          <h1 className="font-display mt-6 text-3xl font-semibold">
            {M.orderStatus.invalidToken}
          </h1>
          <p className="mt-3 text-ink-soft">{M.orderStatus.expiredNote}</p>
        </>
      )}
      <Link
        href="/"
        className="mt-10 inline-block rounded-lg bg-felt px-6 py-3 text-sm font-semibold text-paper hover:bg-felt-soft"
      >
        {M.cart.continueShopping}
      </Link>
    </div>
  );
}
