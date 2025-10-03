// src/algo/computeBestRoute.ts
/// <reference types="google.maps" />
import { getTimeMatrix } from "./timeMatrix";
import { bestOrderNN2OptConstrained } from "./nn2opt";

// Accepts: addresses = (string | LatLngLiteral)[], travelMode, and optional constraints
export type ComputeOpts = {
  departureTime?: Date;
  avoidHighways?: boolean;
  avoidTolls?: boolean;
  returnToStart?: boolean;
  startIndex?: number;
  // constraints:
  prerequisites?: Record<number, number[]>; // afterIdx -> [beforeIdx,...]
  endIndex?: number; // fixed finish stop index (open path)
};

export async function computeBestRoute(
  addresses: Array<string | google.maps.LatLngLiteral>,
  travelMode: google.maps.TravelMode,
  opts: ComputeOpts = {}
): Promise<{ orderedAddresses: (string | google.maps.LatLngLiteral)[]; totalSeconds: number; order: number[] }> {
  const mat = await getTimeMatrix(addresses as any, {
    travelMode,
    departureTime: opts.departureTime,
    avoidHighways: opts.avoidHighways,
    avoidTolls: opts.avoidTolls,
  });

  const start = opts.startIndex ?? 0;
  const roundTrip = !!opts.returnToStart;

  const { order, totalSeconds } = bestOrderNN2OptConstrained(
    mat,
    start,
    roundTrip,
    opts.prerequisites,
    opts.endIndex
  );

  const orderedAddresses = order.map((i) => addresses[i]);
  return { orderedAddresses, totalSeconds, order };
}

// Try multiple departures (e.g., now, +15, +30), keep constraints
export async function suggestBestDeparture(
  addresses: Array<string | google.maps.LatLngLiteral>,
  travelMode: google.maps.TravelMode,
  minutesOffsets: number[],
  baseOpts: Omit<ComputeOpts, "departureTime">
) {
  const results: Array<{ offsetMin: number; totalSeconds: number; order: number[] }> = [];

  for (const off of minutesOffsets) {
    const dt = new Date(Date.now() + off * 60 * 1000);
    const { totalSeconds, order } = await computeBestRoute(addresses, travelMode, {
      ...baseOpts,
      departureTime: dt,
    });
    results.push({ offsetMin: off, totalSeconds, order });
  }

  let best = results[0];
  for (const r of results) if (r.totalSeconds < best.totalSeconds) best = r;

  return {
    bestOffsetMin: best.offsetMin,
    bestSeconds: best.totalSeconds,
    bestOrder: best.order,
    results,
  };
}
