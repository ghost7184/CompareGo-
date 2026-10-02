import type { Config } from "@netlify/functions";

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });

export default async (request: Request) => {
  try {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const apiKey = Netlify.env.get("VYNN_API_KEY");

    if (!apiKey) {
      return json({ error: "VYNN_API_KEY is not configured" }, 500);
    }

    const url = new URL(request.url);

    // Texte cherché (accepte "q" ou "query"), par défaut "milk"
    const q = (url.searchParams.get("q") || url.searchParams.get("query") || "milk").trim();

    // Province sur 2 lettres (ON, QC, BC, AB...), par défaut ON
    const province = (url.searchParams.get("province") || "ON").toUpperCase();

    const limit = url.searchParams.get("limit") || "20";

    const apiUrl = new URL("https://vynn.ai/v1/products/search");
    apiUrl.searchParams.set("q", q);
    apiUrl.searchParams.set("province", province);
    apiUrl.searchParams.set("limit", limit);

    const response = await fetch(apiUrl.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      return json(
        {
          error: "Vynn API request failed",
          status: response.status,
          details: errorText,
        },
        response.status
      );
    }

    const data = await response.json();

    // "private" : la doc Vynn interdit le cache partagé des réponses authentifiées
    return json(data, 200, { "Cache-Control": "private, max-age=300" });
  } catch (error) {
    return json(
      {
        error: "Internal server error",
        details: String(error),
      },
      500
    );
  }
};

export const config: Config = {
  path: "/netlify/functions/vynn-prices",
};
