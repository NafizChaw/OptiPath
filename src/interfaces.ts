
/// <reference types="google.maps" />

export type TravelModeUI = "Driving" | "Walking" | "Bicycling";

export interface AddressStop {
  uid: string;
  name?: string;
  formatted_address?: string;
  isCurrentLocation?: boolean;
  latLng?: google.maps.LatLngLiteral;
  isRefuelStop?: boolean;
  fuelLevelAfter?: number;
  geometry?: {
    location: {
      lat: () => number;
      lng: () => number;
    };
  };
}

export interface SelectionState {
  welcomeAcknowledged: boolean;
  startModeChosen: boolean;
  useCurrentLocation: boolean;
  addressSelectionCompleted: boolean;

  selectedAddresses: AddressStop[];
  optimumRouteAddressOrder: AddressStop[] | null;

  travelMode: TravelModeUI;
  routeOption: "Fastest" | "Shortest";
  startIndex: number;
}

export interface FuelSettings {
  enabled: boolean;
  currentFuelPercent: number;
  tankCapacityGallons: number;
  mpg: number;
  refuelThresholdPercent: number;
}

export interface FuelAnalysis {
  estimatedStops: number;
  totalDistance: number;
  actualStopsAdded: number;
  warnings: string[];
}

export interface DepartureTimeSettings {
  useArrivalTime: boolean;
  departureTime: Date | null;
  arrivalTime: Date | null;
}

export interface RouteConstraints {
  prerequisites: Record<string, string[]>;
  finishUid: string | null;
}

export interface ChatPlanPayload {
  origin: Partial<AddressStop>;
  stops: Partial<AddressStop>[];
  finish?: Partial<AddressStop>;
  constraints?: Array<[number, number]>;
}

export interface OptimizationOptions {
  startIndex?: number;
  returnToStart?: boolean;
  departureTime?: Date;
  prerequisites?: Record<number, number[]>;
  endIndex?: number;
  avoidHighways?: boolean;
  avoidTolls?: boolean;
}

export interface RouteResult {
  order: number[];
  orderedAddresses: (string | google.maps.LatLngLiteral)[];
  totalSeconds: number;
}

export interface DepartureHint {
  bestOffsetMin: number;
  bestSeconds: number;
  bestOrder: number[];
  results: Array<{
    offsetMin: number;
    totalSeconds: number;
    order: number[];
  }>;
}