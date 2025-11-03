/// <reference types="google.maps" />

export type OriginDest = string | google.maps.LatLngLiteral;

export async function getTurnMatrix(
  addresses: OriginDest[],
  travelMode: google.maps.TravelMode
): Promise<number[][]> {
  const directionsService = new google.maps.DirectionsService();

  const n = addresses.length;
  const turnsMatrix: number[][] = Array.from({ length: n }, () =>
    Array(n).fill(Infinity)
  );

  async function getStepCount(
    origin: OriginDest,
    destination: OriginDest
  ): Promise<number> {
    const res: google.maps.DirectionsResult = await new Promise((resolve, reject) => {
      directionsService.route(
        {
          origin,
          destination,
          travelMode,
        },
        (result, status) => {
          if (status === "OK" && result) resolve(result);
          else reject(new Error("Directions failed: " + status));
        }
      );
    });

    const route = res.routes?.[0];
    if (!route) return Infinity;

    let stepCount = 0;
    for (const leg of route.legs ?? []) {
      if (Array.isArray(leg.steps)) {
        stepCount += leg.steps.length;
      }
    }
    return stepCount;
  }

  for (let i = 0; i < n; i++) {
    turnsMatrix[i][i] = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;

      try {
        const steps = await getStepCount(addresses[i], addresses[j]);
        turnsMatrix[i][j] = steps;
      } catch (err) {
        console.error("turn matrix pair failed", i, "->", j, err);
        // leave Infinity if we couldn't get a route
      }
    }
  }

  return turnsMatrix;
}
