// untested, just a starting point for the Uniform Cost Search algo (UCS)
/// <reference types="google.maps" />
import { getTimeMatrix } from "./timeMatrix";
import { ucsBestOrder } from "./ucs";

export async function computeBestRoute( addresses: string[], travelMode: google.maps.TravelMode, startIndex = 0, 
    returnToStart = false): Promise<{ orderedAddresses: string[]; totalSeconds: number; order: number[] }> {
    const mat = await getTimeMatrix(addresses, travelMode);
    const { order, totalSeconds } = ucsBestOrder(mat, startIndex, returnToStart);
    const orderedAddresses = order.map(i => addresses[i]);
    return { orderedAddresses, totalSeconds, order };
}
