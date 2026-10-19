import { createServerFn } from "@tanstack/react-start";

type OfferView = { shop: string; price: number; url: string; title: string };

export const quoteProducts = createServerFn({ method: "POST" })
  .validator((input: { names: string[] }) => {
    const names = Array.isArray(input?.names) ? input.names : [];
    return {
      names: names
        .filter((name): name is string => typeof name === "string")
        .map((name) => name.trim().slice(0, 120))
        .filter((name) => name.length >= 2)
        .slice(0, 8),
    };
  })
  .handler(async ({ data }) => {
    const { lookupOffers } = await import("@/lib/prices.server");
    const results: {
      name: string;
      offers: OfferView[];
      error: "blocked" | "timeout" | "empty" | "failed" | null;
    }[] = [];
    for (const name of data.names) {
      try {
        const offers = await lookupOffers(name);
        results.push({
          name,
          offers,
          error: offers.length === 0 ? "empty" : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        const code = /blocked/i.test(message) ? "blocked" : /timeout|aborted/i.test(message) ? "timeout" : "failed";
        results.push({ name, offers: [], error: code });
      }
      if (data.names.length > 1) await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return results;
  });
