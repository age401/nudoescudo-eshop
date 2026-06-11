import { CartPage } from "@/components/CartPage";
import { getPricingContext } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tu pedido — NudoEscudo" };

export default async function PedidoPage() {
  const { fxRate } = await getPricingContext();
  return <CartPage fxRate={fxRate} />;
}
