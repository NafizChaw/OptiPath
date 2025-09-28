/// <reference types="google.maps" />
import { getTimeMatrix, type OriginDest } from './timeMatrix';
import { bestOrderNN2Opt } from './nn2opt';

export type ComputeOpts = {
  departureTime?: Date;
  avoidHighways?: boolean;
  avoidTolls?: boolean;
  returnToStart?: boolean;
  startIndex?: number;
};

export async function computeBestRoute(
  addresses: OriginDest[],
  travelMode: google.maps.TravelMode,
  opts: ComputeOpts = {}
): Promise<{ orderedAddresses: OriginDest[]; totalSeconds: number; order: number[] }> {
  const mat = await getTimeMatrix(addresses, {
    travelMode,
    departureTime: opts.departureTime,
    avoidHighways: opts.avoidHighways,
    avoidTolls: opts.avoidTolls,
  });

  const start = opts.startIndex ?? 0;
  const roundTrip = !!opts.returnToStart;

  const { order, totalSeconds } = bestOrderNN2Opt(mat, start, roundTrip);
  const orderedAddresses = order.map(i => addresses[i]);
  return { orderedAddresses, totalSeconds, order };
}

export async function suggestBestDeparture(
  addresses: OriginDest[],
  travelMode: google.maps.TravelMode,
  minutesOffsets: number[],
  baseOpts: Omit<ComputeOpts, 'departureTime'>
) {
  const results: Array<{ offsetMin: number; totalSeconds: number; order: number[] }> = [];
  for (const off of minutesOffsets) {
    const dt = new Date(Date.now() + off * 60 * 1000);
    const { totalSeconds, order } = await computeBestRoute(
      addresses, travelMode, { ...baseOpts, departureTime: dt }
    );
    results.push({ offsetMin: off, totalSeconds, order });
  }
  let best = results[0];
  for (const r of results) if (r.totalSeconds < best.totalSeconds) best = r;
  return { bestOffsetMin: best.offsetMin, bestSeconds: best.totalSeconds, bestOrder: best.order, results };
}
