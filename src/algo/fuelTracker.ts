/// <reference types="google.maps" />



export type FuelConfig = {
  currentFuelPercent: number;      
  tankCapacityGallons: number;     
  mpg: number;                    
  refuelThresholdPercent: number;  
};

export type RouteWithFuel = {
  stops: Array<{
    address: string | google.maps.LatLngLiteral;
    isRefuelStop: boolean;
    fuelLevelAfter: number;        
    distanceFromPrevious?: number; 
  }>;
  totalDistance: number;          
  refuelStopsAdded: number;
  warnings: string[];
};


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
      {
        origins: [origin as any],
        destinations: [destination as any],
        travelMode: mode,
        unitSystem: google.maps.UnitSystem.IMPERIAL
      },
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
    const A = await geocodeIfNeeded(a);
    const B = await geocodeIfNeeded(b);
    return haversineMiles(A, B);
  }
}


async function getRoutePolyline(
  a: string | google.maps.LatLngLiteral,
  b: string | google.maps.LatLngLiteral,
  mode: google.maps.TravelMode
): Promise<google.maps.LatLngLiteral[] | null> {
  await ensureGoogleLoaded();
  const ds = new google.maps.DirectionsService();
  const res = await new Promise<google.maps.DirectionsResult | null>((resolve) =>
    ds.route(
      { origin: a as any, destination: b as any, travelMode: mode },
      (r, status) => resolve(status === "OK" ? r : null)
    )
  );
  const path = res?.routes?.[0]?.overview_path;
  if (!path?.length) return null;
  return path.map(p => ({ lat: p.lat(), lng: p.lng() }));
}

function cumulativeMiles(path: google.maps.LatLngLiteral[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) {
    cum[i] = cum[i-1] + haversineMiles(path[i-1], path[i]);
  }
  return cum;
}

function pointAtMiles(
  path: google.maps.LatLngLiteral[],
  cum: number[],
  targetMiles: number
): google.maps.LatLngLiteral {
  if (targetMiles <= 0) return path[0];
  const total = cum[cum.length - 1];
  if (targetMiles >= total) return path[path.length - 1];
  let idx = 1;
  while (idx < cum.length && cum[idx] < targetMiles) idx++;
  const prev = idx - 1;
  const segMiles = cum[idx] - cum[prev];
  const t = segMiles > 0 ? (targetMiles - cum[prev]) / segMiles : 0;
  const A = path[prev], B = path[idx];
  return { lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t };
}


async function findNearbyGasStation(point: google.maps.LatLngLiteral, baseRadius = 8000) {
  await ensureGoogleLoaded();
  const places = new google.maps.places.PlacesService(document.createElement("div"));

  const tryRadius = async (r: number) =>
    new Promise<google.maps.places.PlaceResult[]>((resolve) =>
      places.nearbySearch(
        { location: point, radius: r, type: "gas_station" },
        (rslts, status) =>
          resolve(status === google.maps.places.PlacesServiceStatus.OK ? (rslts || []) : [])
      )
    );

  const rings = [baseRadius, baseRadius * 1.5, baseRadius * 2.25, baseRadius * 3];
  for (const r of rings) {
    const results = await tryRadius(r);
    if (results.length) {
      results.sort(
        (p, q) =>
          (q.rating ?? 0) - (p.rating ?? 0) ||
          (q.user_ratings_total ?? 0) - (p.user_ratings_total ?? 0)
      );
      const loc = results[0].geometry?.location;
      if (loc) return { lat: loc.lat(), lng: loc.lng() };
    }
  }
  return null;
}

async function bestGasBetween(
  a: string | google.maps.LatLngLiteral,
  b: string | google.maps.LatLngLiteral,
  mode: google.maps.TravelMode,
  preferredMilesFromOrigin?: number 
) {
  const poly = await getRoutePolyline(a, b, mode);
  if (poly && poly.length >= 2 && preferredMilesFromOrigin != null) {
    const cum = cumulativeMiles(poly);
    const probe = pointAtMiles(poly, cum, preferredMilesFromOrigin);
    const near = await findNearbyGasStation(probe, 8000);
    if (near) return near;
  }

  const A = await geocodeIfNeeded(a);
  const B = await geocodeIfNeeded(b);
  const lerp = (t: number) => ({ lat: A.lat + (B.lat - A.lat) * t, lng: A.lng + (B.lng - A.lng) * t });

  for (const t of [0.33, 0.5, 0.67]) {
    const p = lerp(t);
    const g = await findNearbyGasStation(p, 8000);
    if (g) return g;
  }
  return await findNearbyGasStation(lerp(0.5), 16000);
}

export async function addRefuelStops(
  orderedAddresses: Array<string | google.maps.LatLngLiteral>,
  fuel: FuelConfig,
  travelMode: google.maps.TravelMode = google.maps.TravelMode.DRIVING
): Promise<RouteWithFuel> {
  if (travelMode !== google.maps.TravelMode.DRIVING) {
    return {
      stops: orderedAddresses.map(a => ({
        address: a, isRefuelStop: false, fuelLevelAfter: fuel.currentFuelPercent
      })),
      totalDistance: 0,
      refuelStopsAdded: 0,
      warnings: ["Fuel tracking only applies to Driving mode."]
    };
  }

  const warnings: string[] = [];
  const out: RouteWithFuel["stops"] = [];

  const fullMiles  = fuel.tankCapacityGallons * fuel.mpg; 
  const minMiles   = fullMiles * (fuel.refuelThresholdPercent / 100); 
  let remaining    = fullMiles * (fuel.currentFuelPercent / 100);
  let totalMiles   = 0;
  let refuels      = 0;

  out.push({
    address: orderedAddresses[0],
    isRefuelStop: false,
    fuelLevelAfter: Math.min(100, (remaining / fullMiles) * 100)
  });

  for (let i = 0; i < orderedAddresses.length - 1; i++) {
    let origin = orderedAddresses[i];
    const dest = orderedAddresses[i + 1];

    while (true) {
      let legMiles = 0;
      try { legMiles = await getLegMiles(origin, dest, travelMode); } catch {}

      const after = remaining - legMiles;

      if (after >= minMiles) {
        remaining = after;
        totalMiles += legMiles;
        out.push({
          address: dest,
          isRefuelStop: false,
          fuelLevelAfter: Math.max(0, (remaining / fullMiles) * 100),
          distanceFromPrevious: legMiles
        });
        break; 
      }

    
      const bufferMi = Math.max(10, 0.1 * fullMiles); 
      const targetFromOrigin = Math.max(0, remaining - (minMiles + bufferMi));

      const station = await bestGasBetween(origin, dest, travelMode, targetFromOrigin);
      if (!station) {
        warnings.push("No gas station found on a long leg; proceeding without insert.");
        remaining = Math.max(0, after);
        totalMiles += legMiles;
        out.push({
          address: dest,
          isRefuelStop: false,
          fuelLevelAfter: Math.max(0, (remaining / fullMiles) * 100),
          distanceFromPrevious: legMiles
        });
        break;
      }

      const toStation = await getLegMiles(origin, station, travelMode);

   
      if (remaining - toStation < 0) {
        totalMiles += toStation;
        remaining = 0;
      } else {
        totalMiles += toStation;
        remaining -= toStation;
      }

      out.push({
        address: station,
        isRefuelStop: true,
        fuelLevelAfter: 100,
        distanceFromPrevious: toStation
      });
      refuels++;
      remaining = fullMiles; 

      origin = station;
    }
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
