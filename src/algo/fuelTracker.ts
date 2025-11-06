/// <reference types="google.maps" />

export type FuelConfig = {
  currentFuelPercent: number;           // 0..100
  tankCapacityGallons: number;          // e.g., 15
  mpg: number;                          // e.g., 25
  refuelThresholdPercent: number;       // e.g., 25 (¼ tank)
};

export type RouteWithFuel = {
  stops: Array<{
    address: string | google.maps.LatLngLiteral;
    isRefuelStop: boolean;
    fuelLevelAfter: number;             // % after arriving at this stop
    distanceFromPrevious?: number;      // miles
  }>;
  totalDistance: number;
  refuelStopsAdded: number;
  warnings: string[];
};

/* ---------- helpers ---------- */

async function ensureGoogleLoaded(): Promise<void> {
  if ((window as any).google?.maps) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&v=weekly`;
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps JS"));
    document.head.appendChild(s);
  });
}

function haversineMiles(a: google.maps.LatLngLiteral, b: google.maps.LatLngLiteral): number {
  const R = 3958.7613;
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let geocoder: google.maps.Geocoder | null = null;
async function geocodeIfNeeded(addr: string | google.maps.LatLngLiteral): Promise<google.maps.LatLngLiteral> {
  await ensureGoogleLoaded();
  if (typeof addr !== "string") return addr;
  geocoder ||= new google.maps.Geocoder();
  const { results } = await geocoder.geocode({ address: addr });
  const loc = results?.[0]?.geometry?.location;
  if (!loc) throw new Error("Geocode failed");
  return { lat: loc.lat(), lng: loc.lng() };
}

async function distanceMatrixMiles(
  origin: string | google.maps.LatLngLiteral,
  destination: string | google.maps.LatLngLiteral,
  mode: google.maps.TravelMode
): Promise<number> {
  await ensureGoogleLoaded();
  const svc = new google.maps.DistanceMatrixService();
  const res = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) =>
    svc.getDistanceMatrix(
      { origins: [origin as any], destinations: [destination as any], travelMode: mode, unitSystem: google.maps.UnitSystem.IMPERIAL },
      (r, status) => (status === "OK" && r) ? resolve(r) : reject(new Error(String(status)))
    )
  );
  const m = res.rows?.[0]?.elements?.[0]?.distance?.value ?? 0;
  return m / 1609.344;
}

async function getLegMiles(
  a: string | google.maps.LatLngLiteral,
  b: string | google.maps.LatLngLiteral,
  mode: google.maps.TravelMode
): Promise<number> {
  try {
    return await distanceMatrixMiles(a, b, mode);
  } catch {
    // fallback to haversine
    const A = await geocodeIfNeeded(a);
    const B = await geocodeIfNeeded(b);
    return haversineMiles(A, B);
  }
}

async function findNearbyGasStation(point: google.maps.LatLngLiteral, radius = 8000) {
  await ensureGoogleLoaded();
  const places = new google.maps.places.PlacesService(document.createElement("div"));
  const results = await new Promise<google.maps.places.PlaceResult[]>((resolve) =>
    places.nearbySearch({ location: point, radius, type: "gas_station" },
      (r, status) => resolve(status === google.maps.places.PlacesServiceStatus.OK ? (r || []) : [])
    )
  );
  if (!results.length) return null;
  results.sort((p, q) => (q.rating ?? 0) - (p.rating ?? 0) || (q.user_ratings_total ?? 0) - (p.user_ratings_total ?? 0));
  const loc = results[0].geometry?.location;
  return loc ? { lat: loc.lat(), lng: loc.lng() } : null;
}

async function bestGasBetween(
  a: string | google.maps.LatLngLiteral,
  b: string | google.maps.LatLngLiteral
) {
  const A = await geocodeIfNeeded(a);
  const B = await geocodeIfNeeded(b);
  const probes = [0.33, 0.5, 0.67].map(t => ({ lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t }));
  for (const p of probes) {
    const g = await findNearbyGasStation(p, 8000);
    if (g) return g;
  }
  return null;
}

/* ---------- public API ---------- */

export async function addRefuelStops(
  orderedAddresses: Array<string | google.maps.LatLngLiteral>,
  fuel: FuelConfig,
  travelMode: google.maps.TravelMode = google.maps.TravelMode.DRIVING
): Promise<RouteWithFuel> {
  if (travelMode !== google.maps.TravelMode.DRIVING) {
    return {
      stops: orderedAddresses.map(a => ({ address: a, isRefuelStop: false, fuelLevelAfter: fuel.currentFuelPercent })),
      totalDistance: 0,
      refuelStopsAdded: 0,
      warnings: ["Fuel tracking only applies to Driving mode."]
    };
  }

  const warnings: string[] = [];
  const out: RouteWithFuel["stops"] = [];

  const fullMiles     = fuel.tankCapacityGallons * fuel.mpg;
  const thresholdMi   = fullMiles * (fuel.refuelThresholdPercent / 100);
  let remainingMiles  = fullMiles * (fuel.currentFuelPercent / 100);
  let totalMiles = 0;
  let refuels = 0;

  for (let i = 0; i < orderedAddresses.length - 1; i++) {
    const o = orderedAddresses[i];
    const d = orderedAddresses[i + 1];

    if (i === 0) out.push({ address: o, isRefuelStop: false, fuelLevelAfter: Math.min(100, (remainingMiles / fullMiles) * 100) });

    let leg = 0;
    try { leg = await getLegMiles(o, d, travelMode); } catch { /* fallback handled */ }
    totalMiles += leg;

    const wouldDropBelow = (remainingMiles - leg) < thresholdMi;
    const exceedsRange   = leg > remainingMiles;

    if (wouldDropBelow || exceedsRange) {
      const gas = await bestGasBetween(o, d);
      if (gas) {
        // distance split o->gas and gas->d
        const toGas = await getLegMiles(o, gas, travelMode);
        const gasToD = await getLegMiles(gas, d, travelMode);

        remainingMiles -= toGas;
        out.push({ address: gas, isRefuelStop: true, fuelLevelAfter: 100, distanceFromPrevious: toGas });

        remainingMiles = fullMiles; // refill
        remainingMiles -= gasToD;

        out.push({ address: d, isRefuelStop: false, fuelLevelAfter: Math.max(0, (remainingMiles / fullMiles) * 100), distanceFromPrevious: gasToD });
        refuels++;
        continue;
      } else {
        warnings.push("Could not find a gas station on a leg; continuing without insert.");
      }
    }

    remainingMiles -= leg;
    out.push({ address: d, isRefuelStop: false, fuelLevelAfter: Math.max(0, (remainingMiles / fullMiles) * 100), distanceFromPrevious: leg });
  }

  return { stops: out, totalDistance: totalMiles, refuelStopsAdded: refuels, warnings };
}

export function canCompleteWithoutRefuel(totalDistanceMiles: number, cfg: FuelConfig): boolean {
  const currentRange = (cfg.currentFuelPercent / 100) * cfg.tankCapacityGallons * cfg.mpg;
  return totalDistanceMiles <= currentRange;
}

export function estimateRefuelStops(totalDistanceMiles: number, cfg: FuelConfig): number {
  const initialRange = (cfg.currentFuelPercent / 100) * cfg.tankCapacityGallons * cfg.mpg;
  if (totalDistanceMiles <= initialRange) return 0;
  const perFillUsable = cfg.tankCapacityGallons * cfg.mpg * (1 - cfg.refuelThresholdPercent / 100);
  const remaining = totalDistanceMiles - initialRange;
  return Math.max(0, Math.ceil(remaining / Math.max(1, perFillUsable)));
}
