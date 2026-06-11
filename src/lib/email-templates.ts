import type { orderItems, orders } from "@/db/schema";
import { M } from "@/lib/messages";
import { formatUsd, formatUyu } from "@/lib/pricing";

type Order = typeof orders.$inferSelect;
type Item = typeof orderItems.$inferSelect;

const FINISH_ES: Record<string, string> = {
  nonfoil: "Normal",
  foil: "Foil",
  etched: "Foil grabado",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function itemsTable(items: Item[]): string {
  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e3d8;">
          <strong>${esc(i.cardName)}</strong><br>
          <span style="color:#6b756e;font-size:13px;">
            ${esc(i.setName)} · ${FINISH_ES[i.finish] ?? i.finish} · ${esc(i.condition)} · ${esc(i.language.toUpperCase())}
          </span>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e3d8;text-align:center;">${i.quantity}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e8e3d8;text-align:right;white-space:nowrap;">
          ${formatUsd(Number(i.unitPriceUsd))}
        </td>
      </tr>`,
    )
    .join("");
  return `
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      <thead>
        <tr style="background:#f1ece2;">
          <th style="padding:8px 12px;text-align:left;">Carta</th>
          <th style="padding:8px 12px;">Cant.</th>
          <th style="padding:8px 12px;text-align:right;">Precio</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function totals(order: Order): string {
  const uyu = order.totalUyu
    ? ` <span style="color:#6b756e;">(≈ ${formatUyu(Number(order.totalUyu))})</span>`
    : "";
  return `<p style="font-size:18px;"><strong>Total: ${formatUsd(Number(order.totalUsd))}</strong>${uyu}</p>`;
}

function shell(title: string, body: string): string {
  return `
  <div style="background:#faf7f1;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#1d2420;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e8e3d8;">
      <div style="background:#0f3527;color:#faf7f1;padding:20px 24px;">
        <h1 style="margin:0;font-size:20px;">${M.storeName}</h1>
      </div>
      <div style="padding:24px;">
        <h2 style="margin-top:0;font-size:18px;">${title}</h2>
        ${body}
      </div>
      <div style="padding:16px 24px;background:#f1ece2;color:#6b756e;font-size:12px;">
        ${M.footer.pricesNote}
      </div>
    </div>
  </div>`;
}

export function confirmationEmail(order: Order, items: Item[], siteUrl: string) {
  const link = `${siteUrl}/confirmar/${order.confirmationToken}`;
  const body = `
    <p>¡Gracias por tu pedido! Para reservar tus cartas, confirmalo haciendo clic en el botón:</p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${link}" style="background:#0f3527;color:#faf7f1;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;display:inline-block;">
        Confirmar pedido ${esc(order.publicCode)}
      </a>
    </p>
    <p style="color:#6b756e;font-size:13px;">Si el botón no funciona, copiá este enlace: <br><a href="${link}">${link}</a></p>
    ${itemsTable(items)}
    ${totals(order)}
    <p style="color:#6b756e;font-size:13px;">
      El pedido queda reservado hasta que lo confirmes. Si no lo confirmás, la reserva se libera automáticamente.
      No hay pago online: la tienda se contacta con vos para coordinar entrega y pago.
    </p>`;
  return {
    subject: M.email.confirmSubject(order.publicCode),
    html: shell(`Confirmá tu pedido ${esc(order.publicCode)}`, body),
  };
}

export function adminNewOrderEmail(order: Order, items: Item[], siteUrl: string) {
  const body = `
    <p><strong>${esc(order.email)}</strong>${order.customerName ? ` (${esc(order.customerName)})` : ""}${order.phone ? ` · Tel: ${esc(order.phone)}` : ""} confirmó un pedido.</p>
    ${itemsTable(items)}
    ${totals(order)}
    <p style="text-align:center;margin:24px 0;">
      <a href="${siteUrl}/admin/pedidos/${order.id}" style="background:#0f3527;color:#faf7f1;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;display:inline-block;">
        Ver pedido en el panel
      </a>
    </p>`;
  return {
    subject: M.email.adminNewOrderSubject(order.publicCode),
    html: shell(`Nuevo pedido confirmado ${esc(order.publicCode)}`, body),
  };
}
