import { InStoreSale } from "@/components/admin/InStoreSale";
import { M } from "@/lib/messages";

export const dynamic = "force-dynamic";
export const metadata = { title: `${M.admin.sale.title} — ${M.storeName}` };

export default function InStoreSalePage() {
  return (
    <div>
      <h2 className="font-display text-xl font-semibold">{M.admin.sale.title}</h2>
      <div className="mt-4">
        <InStoreSale />
      </div>
    </div>
  );
}
