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

    const apiUrl = new URL("https://vynn.ai/v1/stores");
    const province = url.searchParams.get("province");
    const banner = url.searchParams.get("banner");
    const limit = url.searchParams.get("limit") || "100";
    const offset = url.searchParams.get("offset");

    if (province) apiUrl.searchParams.set("province", province.toUpperCase());
    if (banner) apiUrl.searchParams.set("banner", banner);
    apiUrl.searchParams.set("limit", limit);
    if (offset) apiUrl.searchParams.set("offset", offset);

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
        { error: "Vynn API request failed", status: response.status, details: errorText },
        response.status
      );
    }

    const data = await response.json();

    // "private" : la doc Vynn interdit le cache partagé des réponses authentifiées
    return json(data, 200, { "Cache-Control": "private, max-age=3600" });
  } catch (error) {
    return json({ error: "Internal server error", details: String(error) }, 500);
  }
};

export const config: Config = {
  path: "/netlify/functions/vynn-stores",
};
