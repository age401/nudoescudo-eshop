import { SubNav } from "@/components/admin/SubNav";
import { M } from "@/lib/messages";

export default function StockLayout({ children }: { children: React.ReactNode }) {
  const T = M.admin.stock.tabs;
  return (
    <div>
      <SubNav
        links={[
          { href: "/admin/stock", label: T.inventory, exact: true },
          { href: "/admin/stock/importar", label: T.import },
          { href: "/admin/stock/movimientos", label: T.movements },
        ]}
      />
      <div className="pt-6">{children}</div>
    </div>
  );
}
