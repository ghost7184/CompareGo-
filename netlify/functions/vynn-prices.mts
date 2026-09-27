import type { Config, Handler } from "@netlify/functions";

export default (async (request) => {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        {
          status: 405,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const apiKey = Netlify.env.get("VYNN_API_KEY");

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "VYNN_API_KEY is not configured" }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(request.url);

    const city =
      url.searchParams.get("city") || "Ottawa";

    const query =
      url.searchParams.get("query") || "grocery prices";

    /*
      IMPORTANT:
      Remplace cette URL et le format du body
      par ceux indiqués dans la documentation Vynn.
    */

    const response = await fetch("VYNN_API_ENDPOINT", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        city,
        query,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();

      return new Response(
        JSON.stringify({
          error: "Vynn API request failed",
          details: errorText,
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Internal server error",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}) satisfies Handler;

export const config: Config = {
  path: "/netlify/functions/vynn-prices",
};
