// src/algo/computeBestRoute.ts
/// <reference types="google.maps" />
import { getTimeMatrix } from "./timeMatrix";
import { getTurnMatrix } from "./turnMatrix";
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
  strategy?: "Fastest" | "Shortest Distance" | "Least Turns";
};

function totalTimeForOrder(
  order: number[],
  timeMatrix: number[][],
  roundTrip: boolean
): number {
  let sum = 0;
  for (let i = 0; i < order.length - 1; i++) {
    const a = order[i];
    const b = order[i + 1];
    sum += timeMatrix[a][b] ?? 0;
  }
  if (roundTrip && order.length > 1) {
    const firstStop = order[0];
    const lastStop = order[order.length - 1];
    sum += timeMatrix[lastStop][firstStop] ?? 0;
  }
  return sum;
}

export async function computeBestRoute(
  addresses: Array<string | google.maps.LatLngLiteral>,
  travelMode: google.maps.TravelMode,
  opts: ComputeOpts = {}
): Promise<{ 
  orderedAddresses: (string | google.maps.LatLngLiteral)[]; totalSeconds: number; order: number[] }> {
  const mat = await getTimeMatrix(addresses as any, {
    travelMode,
    departureTime: opts.departureTime,
    avoidHighways: opts.avoidHighways,
    avoidTolls: opts.avoidTolls,
  });

  const start = opts.startIndex ?? 0;
  const roundTrip = !!opts.returnToStart;
  const strategy = opts.strategy ?? "Fastest";

  let costMatrixToOptimize: number[][];

  if (strategy === "Fastest") {
    costMatrixToOptimize = mat.timeSeconds;
  } else if (strategy === "Shortest Distance") {
    costMatrixToOptimize = mat.distanceMeters;
  } else if (strategy === "Least Turns") {
    const turnsMatrix = await getTurnMatrix(addresses as any, travelMode);
    costMatrixToOptimize = turnsMatrix;
  } else {
    costMatrixToOptimize = mat.timeSeconds;
  }

  const { order } = bestOrderNN2OptConstrained(
    costMatrixToOptimize,
    start,
    roundTrip,
    opts.prerequisites,
    opts.endIndex
  );

  const totalSeconds = totalTimeForOrder(order, mat.timeSeconds, roundTrip);
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
      strategy: "Fastest",
    });
    results.push({ offsetMin: off, totalSeconds, order });
  }

  let best = results[0];
  for (const r of results) {
    if (r.totalSeconds < best.totalSeconds) {
      best = r;
    }
  }

  return {
    bestOffsetMin: best.offsetMin,
    bestSeconds: best.totalSeconds,
    bestOrder: best.order,
    results,
  };
}
