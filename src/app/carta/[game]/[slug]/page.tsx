import { notFound } from "next/navigation";
import { CardView } from "@/components/CardView";
import { getCardBySlug } from "@/lib/catalog";
import { getPricingContext } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function CardPage({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}) {
  const { game, slug } = await params;
  const [card, pricing] = await Promise.all([
    getCardBySlug(game, slug),
    getPricingContext(),
  ]);
  if (!card) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <CardView card={card} multiplier={pricing.multiplier} fxRate={pricing.fxRate} />
    </div>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game: string; slug: string }>;
}) {
  const { game, slug } = await params;
  const card = await getCardBySlug(game, slug);
  return { title: card ? `${card.name} — ${card.gameName}` : "Carta" };
}
