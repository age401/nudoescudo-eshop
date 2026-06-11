import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { orderItems, orders } from "@/db/schema";
import { confirmationEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { M } from "@/lib/messages";
import { createOrder } from "@/lib/orders";

const Body = z.object({
  email: z.string().email(),
  customerName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  items: z
    .array(
      z.object({
        stockId: z.string().uuid(),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .min(1)
    .max(100),
});

export async function POST(req: NextRequest) {
  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    parsed = { success: false as const, error: null };
  }
  if (!parsed.success) {
    return NextResponse.json({ error: M.errors.generic }, { status: 400 });
  }

  const result = await createOrder(parsed.data);
  if (!result.ok) {
    return NextResponse.json(
      { error: "stock", problems: result.problems },
      { status: 409 },
    );
  }

  // Send the confirmation email. If it fails, surface an error but keep the
  // order (admin can resend / the reservation expires on its own).
  const [order] = await db.select().from(orders).where(eq(orders.id, result.orderId));
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, result.orderId));
  try {
    const mail = confirmationEmail(order, items, env("SITE_URL", "http://localhost:3000"));
    await sendMail({ to: order.email, ...mail });
  } catch (err) {
    console.error("Failed to send confirmation email", err);
    return NextResponse.json(
      { ok: true, publicCode: result.publicCode, emailFailed: true },
      { status: 201 },
    );
  }

  return NextResponse.json(
    { ok: true, publicCode: result.publicCode },
    { status: 201 },
  );
}
