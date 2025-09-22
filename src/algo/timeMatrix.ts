// untested, just a starting point for the Uniform Cost Search algo (UCS)
/// <reference types="google.maps" />

export async function getTimeMatrix(
    addresses: string[],
    travelMode: google.maps.TravelMode
): Promise<number[][]> {
    const svc = new google.maps.DistanceMatrixService();

    const resp = await new Promise<google.maps.DistanceMatrixResponse>((resolve, reject) => {
        svc.getDistanceMatrix(
            {
            origins: addresses,
            destinations: addresses,
            travelMode,
            drivingOptions: travelMode === google.maps.TravelMode.DRIVING ? { departureTime: new Date() } : undefined,
            avoidHighways: false,
            avoidTolls: false,
            unitSystem: google.maps.UnitSystem.IMPERIAL
            },
            (res, status) => (status === "OK" && res) ? resolve(res) : reject(new Error("DistanceMatrix failed: " + status))
        );
    });

    const N = addresses.length;
    const mat: number[][] = Array.from({ length: N }, () => Array(N).fill(Infinity));

    resp.rows.forEach((row, i) => {
        row.elements.forEach((el, j) => {
            mat[i][j] = (el.status === "OK" && el.duration) ? el.duration.value : Infinity;
        });
    });

    for (let i = 0; i < N; i++) mat[i][i] = 0;
    return mat;
}
