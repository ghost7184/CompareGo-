import type { Config } from "@netlify/functions";

/*
  Une seule fonction pour tout :
  - /netlify/functions/vynn-prices?q=milk&province=ON      -> prix
  - /netlify/functions/vynn-prices?mode=stores&near=45.42,-75.69&radius=60  -> magasins
*/

const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });

/* ---------------- Magasins ---------------- */

const PAGE_SIZE = 100;
const MAX_PAGES = 15; // protège ton quota d'appels Vynn
const CACHE_MS = 12 * 3600 * 1000;
const cache = new Map<string, { t: number; payload: unknown }>();

const num = (o: any, keys: string[]): number | null => {
  if (!o || typeof o !== "object") return null;
  for (const k of keys) {
    const v = o[k];
    if (v !== null && v !== undefined && v !== "" && isFinite(Number(v))) return Number(v);
  }
  return null;
};

const val = (x: any): string => {
  if (x && typeof x === "object") return String(x.value ?? x.name ?? "");
  return x === null || x === undefined ? "" : String(x);
};

const rowsOf = (d: any): any[] => {
  if (Array.isArray(d)) return d;
  if (d && typeof d === "object") {
    for (const k of ["stores", "results", "data", "items"]) {
      if (Array.isArray(d[k])) return d[k];
    }
    if (d.data && typeof d.data === "object") return rowsOf(d.data);
  }
  return [];
};

const normalize = (r: any) => {
  if (!r || typeof r !== "object") return null;
  const geo = r.location || r.geo || r.geometry || r.coordinates || {};
  let lat = num(r, ["lat", "latitude"]);
  let lng = num(r, ["lng", "lon", "long", "longitude"]);
  if (lat === null) lat = num(geo, ["lat", "latitude"]);
  if (lng === null) lng = num(geo, ["lng", "lon", "long", "longitude"]);
  const arr = Array.isArray(geo) ? geo : Array.isArray(geo.coordinates) ? geo.coordinates : null;
  if ((lat === null || lng === null) && arr && arr.length >= 2) {
    lng = Number(arr[0]);
    lat = Number(arr[1]);
  }
  const banner = val(r.banner) || val(r.banner_slug) || val(r.chain) || val(r.retailer) || val(r.provider);
  if (lat === null || lng === null || !banner) return null;
  return {
    banner,
    name: val(r.name) || val(r.store_name),
    address: val(r.address) || val(r.street),
    city: val(r.city),
    lat,
    lng,
  };
};

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

async function handleStores(url: URL, apiKey: string) {
  const province = (url.searchParams.get("province") || "ON").toUpperCase();
  const near = (url.searchParams.get("near") || "").split(",").map(Number);
  const radius = Number(url.searchParams.get("radius") || "60");
  const hasNear = near.length === 2 && isFinite(near[0]) && isFinite(near[1]);

  const cacheKey = `${province}|${hasNear ? near.join(",") : "all"}|${radius}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.t < CACHE_MS) {
    return json(hit.payload, 200, { "Cache-Control": "private, max-age=3600" });
  }

  const kept: any[] = [];
  let scanned = 0;
  let truncated = false;

  for (let page = 0; page < MAX_PAGES; page++) {
    const apiUrl = new URL("https://vynn.ai/v1/stores");
    apiUrl.searchParams.set("province", province);
    apiUrl.searchParams.set("limit", String(PAGE_SIZE));
    apiUrl.searchParams.set("offset", String(page * PAGE_SIZE));

    const response = await fetch(apiUrl.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return json(
        { error: "Vynn API request failed", status: response.status, details: errorText },
        response.status
      );
    }

    const rows = rowsOf(await response.json());
    scanned += rows.length;

    for (const r of rows) {
      const s = normalize(r);
      if (!s) continue;
      if (hasNear && km(near[0], near[1], s.lat, s.lng) > radius) continue;
      kept.push(s);
    }

    if (rows.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const payload = { stores: kept, scanned, truncated };
  cache.set(cacheKey, { t: Date.now(), payload });
  return json(payload, 200, { "Cache-Control": "private, max-age=3600" });
}

/* ---------------- Prix ---------------- */

async function handlePrices(url: URL, apiKey: string) {
  const q = (url.searchParams.get("q") || url.searchParams.get("query") || "milk").trim();
  const province = (url.searchParams.get("province") || "ON").toUpperCase();
  const limit = url.searchParams.get("limit") || "20";

  const apiUrl = new URL("https://vynn.ai/v1/products/search");
  apiUrl.searchParams.set("q", q);
  apiUrl.searchParams.set("province", province);
  apiUrl.searchParams.set("limit", limit);

  const response = await fetch(apiUrl.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
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
  return json(data, 200, { "Cache-Control": "private, max-age=300" });
}

/* ---------------- Point d'entrée ---------------- */

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

    if (url.searchParams.get("mode") === "stores") {
      return await handleStores(url, apiKey);
    }
    return await handlePrices(url, apiKey);
  } catch (error) {
    return json({ error: "Internal server error", details: String(error) }, 500);
  }
};

export const config: Config = {
  path: "/netlify/functions/vynn-prices",
};
