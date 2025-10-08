/// <reference types="google.maps" />

export type LatLng = google.maps.LatLngLiteral;

type ResolvedStop = {
  name: string;
  formatted_address?: string;
  latLng?: LatLng;
  isCurrentLocation?: boolean;
};

// The “plan” we receive from Gemini (subset we need to resolve)
export type ChatPlanLite = {
  origin_hint: "current location" | "home" | "address";
  origin_value: string | null;
  stops: string[];
};

export async function ensureGoogleLoaded(): Promise<void> {
  if ((window as any).google?.maps?.places) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps"));
    document.head.appendChild(s);
  });
}

function placesService(): google.maps.places.PlacesService {
  const div = document.createElement("div");
  return new google.maps.places.PlacesService(div);
}

async function geolocate(): Promise<LatLng> {
  const pos = await new Promise<GeolocationPosition>((res, rej) => {
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10000 })
      : rej(new Error("No geolocation"));
  });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

async function textSearchOne(query: string, ref: LatLng): Promise<ResolvedStop | null> {
  const svc = placesService();
  return await new Promise((resolve) => {
    svc.textSearch({ query, location: ref, radius: 6000 }, (results, status) => {
      if (status === "OK" && results && results.length) {
        const r = results[0];
        resolve({
          name: r.name || query,
          formatted_address: r.formatted_address || r.vicinity,
          latLng: r.geometry?.location?.toJSON()
        });
      } else resolve(null);
    });
  });
}

export async function resolveChatPlan(
  plan: ChatPlanLite,
  opts: { homeAddress?: string } = {}
): Promise<{ origin: ResolvedStop; stops: ResolvedStop[] }> {
  await ensureGoogleLoaded();

  // Resolve origin
  let origin: ResolvedStop | null = null;
  if (plan.origin_hint === "current location") {
    const ll = await geolocate();
    origin = { name: "Current Location", isCurrentLocation: true, latLng: ll, formatted_address: "Current Location" };
  } else if (plan.origin_hint === "home") {
    const base = opts.homeAddress;
    if (base) {
      const near = await geolocate();
      origin = (await textSearchOne(base, near)) || { name: "Home", formatted_address: base };
    } else {
      // fallback to current location if no stored home
      const ll = await geolocate();
      origin = { name: "Current Location", isCurrentLocation: true, latLng: ll, formatted_address: "Current Location" };
    }
  } else { // address
    const near = await geolocate();
    const text = plan.origin_value || "";
    origin = (await textSearchOne(text, near)) || { name: text || "Origin", formatted_address: text || "Origin" };
  }

  // Resolve stops relative to origin
  const ref = origin.latLng || (await geolocate());
  const resolved: ResolvedStop[] = [];
  for (const s of plan.stops) {
    const q = (s || "").trim();
    if (!q) continue;

    const latlng = q.match(/^\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)\s*$/);
    if (latlng) {
      resolved.push({
        name: q, formatted_address: q,
        latLng: { lat: parseFloat(latlng[1]), lng: parseFloat(latlng[3]) }
      });
      continue;
    }
    const hit = await textSearchOne(q, ref);
    if (hit) resolved.push(hit);
  }

  return { origin, stops: resolved };
}
