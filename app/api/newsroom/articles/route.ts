import { ARTICLES } from "@/lib/newsroom";

export const dynamic = "force-dynamic";

/** The catalog: free articles open, premium ones carry their Standing Promise price. */
export async function GET() {
  return Response.json({
    articles: ARTICLES.map((a) => ({ slug: a.slug, title: a.title, dek: a.dek, premium: a.premium, price: a.price, currency: a.currency, published: a.published })),
  });
}
