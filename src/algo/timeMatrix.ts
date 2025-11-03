/// <reference types="google.maps" />

export type OriginDest = string | google.maps.LatLngLiteral;
export type TimeMatrix = number[][];

export type MatrixOptions = {
  travelMode: google.maps.TravelMode;
  departureTime?: Date;
  avoidHighways?: boolean;
  avoidTolls?: boolean;
  unitSystem?: google.maps.UnitSystem;
};

export type MatrixResult = {
  timeSeconds: number[][];
  distanceMeters: number[][];
};

export async function getTimeMatrix(
  addresses: OriginDest[],
  opts: MatrixOptions
): Promise<MatrixResult> {
  const svc = new google.maps.DistanceMatrixService();

  const resp = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) => {
    svc.getDistanceMatrix(
      {
        origins: addresses as any[],
        destinations: addresses as any[],
        travelMode: opts.travelMode,
        drivingOptions:
          opts.travelMode === google.maps.TravelMode.DRIVING && opts.departureTime
            ? { departureTime: opts.departureTime }
            : undefined,
        avoidHighways: !!opts.avoidHighways,
        avoidTolls: !!opts.avoidTolls,
        unitSystem: opts.unitSystem ?? google.maps.UnitSystem.IMPERIAL,
      },
      (res, status) => (status === "OK" && res) ? resolve(res) : reject(new Error("DistanceMatrix failed: " + status))
    );
  });

  const n = addresses.length;
  const timeSeconds: number[][]    = Array.from({ length: n }, () => Array(n).fill(Infinity));
  const distanceMeters: number[][] = Array.from({ length: n }, () => Array(n).fill(Infinity));

  resp.rows.forEach((row, i) => {
    row.elements.forEach((el, j) => {
      if (el.status === "OK") {
        if (el.duration?.value != null) timeSeconds[i][j] = el.duration.value;
        if (el.distance?.value != null) distanceMeters[i][j] = el.distance.value;
      }
    });
  });

  for (let i = 0; i < n; i++) {
    timeSeconds[i][i] = 0;
    distanceMeters[i][i] = 0;
  }

  return { timeSeconds, distanceMeters };
}
