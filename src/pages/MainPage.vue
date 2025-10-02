<script setup lang="ts">
import { ref, computed } from "vue";
import {
  MAX_SELECTABLE_ADDRESSES,
  MY_LOCATION,
  WELCOME_MESSAGE,
  LOADING,
} from "../constants";
import AddressComponent from "../components/AddressComponent.vue";
import MapComponent from "../components/MapComponent.vue";
import type { SelectionState } from "../interfaces";
import { computeBestRoute, suggestBestDeparture } from "../algo/computeBestRoute";
import Draggable from 'vuedraggable'

// ---- state ----
const selection_state = ref<SelectionState>({
  welcomeAcknowledged: false,
  addressSelectionCompleted: false,
  selectedAddresses: [],
  optimumRouteAddressOrder: null,
  travelMode: "Driving",
  routeOption: "Fastest",
});

const availableTransportationMethods = ["Driving", "Walking", "Bicycling"];
const canProceed = computed(() => selection_state.value.selectedAddresses.length >= 2);

function withUid<T extends Record<string, any>>(obj: T): T & { uid: string } {
  if ((obj as any)?.uid) return obj as any; 
  const uid = (globalThis.crypto as any)?.randomUUID?.() || String(Date.now() + Math.random()); 
  return { ...obj, uid };
}

// ---- helpers ----
const handleAddressSelected = (newAddress: any, index: number) => { 
  selection_state.value.selectedAddresses[index] = withUid(newAddress);
  if (selection_state.value.optimumRouteAddressOrder) { 
    selection_state.value.optimumRouteAddressOrder = null;
  }
};

const removeSelectedAddress = (index: number) => {
  selection_state.value.selectedAddresses.splice(index, 1);
  if (selection_state.value.optimumRouteAddressOrder) {
    selection_state.value.optimumRouteAddressOrder = null;
  }
};

async function onReordered() {
  selection_state.value.optimumRouteAddressOrder = null;
  await optimizeRoute();
}

async function useCurrentLocationAsOrigin() {
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      navigator.geolocation
        ? navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
        : reject(new Error("Geolocation not supported"));
    });
    selection_state.value.selectedAddresses[0] = withUid({
      formatted_address: 'Current Location',
      isCurrentLocation: true,
      latLng: { lat: pos.coords.latitude, lng: pos.coords.longitude }
    });
    if (selection_state.value.optimumRouteAddressOrder) {
      selection_state.value.optimumRouteAddressOrder = null;
    }
  } catch {
    alert("Could not get current location. Please allow location access.");
  }
}

const previewRoute = () => {
  selection_state.value.optimumRouteAddressOrder = null;
  selection_state.value.addressSelectionCompleted = true;
};

function toGMode(mode: string): google.maps.TravelMode {
  switch (mode) {
    case "Walking": return google.maps.TravelMode.WALKING;
    case "Bicycling": return google.maps.TravelMode.BICYCLING;
    default: return google.maps.TravelMode.DRIVING;
  }
}

function normalizeForMatrix(a: any): string | google.maps.LatLngLiteral {
  return (a?.isCurrentLocation && a?.latLng) ? a.latLng : (a.formatted_address || a.name);
}

async function ensureGoogleLoaded(): Promise<void> {
  if ((window as any).google?.maps) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Maps JS"));
    document.head.appendChild(s);
  });
}

const bestDepartureHint = ref<string | null>(null);

const optimizeRoute = async () => {
  const stops = selection_state.value.selectedAddresses;
  if (!stops || stops.length < 2) return;

  bestDepartureHint.value = null;
  selection_state.value.optimumRouteAddressOrder = LOADING as any;

  try {
    await ensureGoogleLoaded();

    const addresses = stops.map(normalizeForMatrix);
    const mode = toGMode(selection_state.value.travelMode);

    const { order } = await computeBestRoute(addresses, mode, {
      startIndex: 0,
      returnToStart: false,
      departureTime: new Date()
    });

    selection_state.value.optimumRouteAddressOrder = order.map(i => stops[i]);

    // small “leave later” suggestion (0,15,30 min)
    try {
      const hint = await suggestBestDeparture(
        addresses, mode, [0, 15, 30], { startIndex: 0, returnToStart: false }
      );
      bestDepartureHint.value =
        hint.bestOffsetMin > 0
          ? `Tip: leaving in ${hint.bestOffsetMin} min may be faster (≈ ${Math.round(hint.bestSeconds/60)} min total).`
          : `Leaving now is best (≈ ${Math.round(hint.bestSeconds/60)} min total).`;
    } catch { bestDepartureHint.value = null; }
  } catch (e) {
    console.error(e);
    alert("Optimization failed. Ensure Maps JS & Distance Matrix are enabled and billing is on, and disable ad blockers.");
    selection_state.value.optimumRouteAddressOrder = null;
  }
};

// ---- external links ----
function googleMapsLink(addresses: any[], mode: string): string {
  if (!addresses || addresses.length < 2) return "#";
  const base = "https://www.google.com/maps/dir/?api=1";

  const originObj = addresses[0];
  const destObj = addresses[addresses.length - 1];

  const origin =
    originObj?.isCurrentLocation && originObj?.latLng
      ? "My+Location"
      : encodeURIComponent(originObj.formatted_address);

  const destination =
    destObj?.isCurrentLocation && destObj?.latLng
      ? "My+Location"
      : encodeURIComponent(destObj.formatted_address);

  const waypoints =
    addresses
      .slice(1, -1)
      .map((a: any) =>
        a?.isCurrentLocation && a?.latLng
          ? `${a.latLng.lat},${a.latLng.lng}`
          : encodeURIComponent(a.formatted_address)
      )
      .join("|") || "";

  const travelmode = mode.toLowerCase();

  const parts = [
    `origin=${origin}`,
    `destination=${destination}`,
    waypoints ? `waypoints=${waypoints}` : "",
    `travelmode=${travelmode}`,
  ].filter(Boolean);

  return `${base}&${parts.join("&")}`;
}

function appleDirFlag(mode: string) { return mode === "Walking" ? "w" : "d"; }
function appleMapsLink(addresses: any[], mode: string): string {
  if (!addresses || addresses.length < 2) return "#";
  const base = "https://maps.apple.com/";

  const originObj = addresses[0];
  const saddr =
    originObj?.isCurrentLocation && originObj?.latLng
      ? `${originObj.latLng.lat},${originObj.latLng.lng}`
      : encodeURIComponent(originObj.formatted_address);

  const dests = addresses
    .slice(1)
    .map((a: any, idx: number) => {
      const encoded = a?.isCurrentLocation && a?.latLng
        ? `${a.latLng.lat},${a.latLng.lng}`
        : encodeURIComponent(a.formatted_address);
      return idx === 0 ? encoded : `to:${encoded}`;
    })
    .join(" ");

  const dirflg = appleDirFlag(mode);
  return `${base}?saddr=${saddr}&daddr=${dests}&dirflg=${dirflg}`;
}
</script>

<template>
  <div class="container mt-4">
    <div class="row justify-content-center">
      <div class="col-12 col-lg-8">
        <!-- Welcome -->
        <template v-if="!selection_state.welcomeAcknowledged">
          <h2>Welcome to OptiPath</h2>
          <p>{{ WELCOME_MESSAGE }}</p>
          <button class="btn btn-primary btn-sm mt-3" @click="selection_state.welcomeAcknowledged = true">
            GET STARTED
          </button>
        </template>

        <!-- Address collection -->
        <template v-else-if="selection_state.welcomeAcknowledged && !selection_state.addressSelectionCompleted">
          <h2>Addresses</h2>
          <h5>Select at least 2 and up to {{ MAX_SELECTABLE_ADDRESSES }} addresses</h5>

          <Draggable
            v-model="selection_state.selectedAddresses"  
            item-key="uid"                                
            handle=".drag-handle"                   
            @end="onReordered"                           
            class="list-unstyled mt-3"
            :animation="180"
            ghost-class="drag-ghost"
            :delay="120"
            :delay-on-touch-only="true"
          >
            <template #item="{ element, index }">  
              <li class="d-flex align-items-center gap-2 py-1">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                <div class="d-flex flex-column">
                  <strong class="stop-name">
                    {{ element.name || element.formatted_address }}
                  </strong>

                  <!-- <small v-if="element.name" class="stop-address">
                    {{ element.formatted_address }}
                  </small> -->
                </div>
                <button
                v-if="!element?.isCurrentLocation"
                class="btn btn-danger btn-sm ms-2"
                @click="removeSelectedAddress(index)"
                >
                  Remove
                </button>
              </li>
              
            </template>
          </Draggable>

          <hr/>

          <button v-if="selection_state.selectedAddresses.length === 0"
                  class="btn btn-outline-primary btn-sm"
                  @click="useCurrentLocationAsOrigin">
            Use Current Location as Origin
          </button>

          <div v-else-if="selection_state.selectedAddresses.length < MAX_SELECTABLE_ADDRESSES" class="mt-3">
            <label class="form-label">Add an address</label>
            <AddressComponent @addressSelected="handleAddressSelected($event, selection_state.selectedAddresses.length)"/>
          </div>

          <div class="d-flex gap-2 mt-3">
            <button class="btn btn-secondary btn-sm" @click="previewRoute" :disabled="!canProceed">Preview route</button>
            <button class="btn btn-primary btn-sm" @click="selection_state.addressSelectionCompleted = true" :disabled="!canProceed">Next</button>
          </div>
        </template>

        <!-- Preview / Optimize -->
        <template v-else>
          <h2>Route</h2>
          <div class="mb-3">
            <label class="form-label">Mode</label>
            <select class="form-select" :value="selection_state.travelMode" @change="(e:any)=>selection_state.travelMode = e.target.value">
              <option v-for="m in availableTransportationMethods" :key="m" :value="m">{{ m }}</option>
            </select>
          </div>

          <MapComponent
            :addresses="(selection_state.optimumRouteAddressOrder && selection_state.optimumRouteAddressOrder !== 'loading')
              ? (selection_state.optimumRouteAddressOrder as any[])
              : selection_state.selectedAddresses"
            :travelMode="selection_state.travelMode"
          />

          <div class="text-center mt-3" v-if="selection_state.optimumRouteAddressOrder === LOADING">
            Calculating optimum route…
          </div>

          <p v-if="bestDepartureHint" class="mt-2 text-muted">{{ bestDepartureHint }}</p>

          <div class="d-flex flex-wrap gap-2 mt-3">
            <button class="btn btn-outline-secondary btn-sm" @click="previewRoute">Show entered order</button>
            <button class="btn btn-primary btn-sm" @click="optimizeRoute">Optimize order</button>

            <a class="btn btn-success btn-sm"
               :href="googleMapsLink((selection_state.optimumRouteAddressOrder && selection_state.optimumRouteAddressOrder !== 'loading')
                 ? (selection_state.optimumRouteAddressOrder as any[])
                 : selection_state.selectedAddresses, selection_state.travelMode)"
               target="_blank">Open in Google Maps</a>

            <a class="btn btn-dark btn-sm"
               :href="appleMapsLink((selection_state.optimumRouteAddressOrder && selection_state.optimumRouteAddressOrder !== 'loading')
                 ? (selection_state.optimumRouteAddressOrder as any[])
                 : selection_state.selectedAddresses, selection_state.travelMode)"
               target="_blank">Open in Apple Maps</a>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hover-primary:hover { border-color: var(--bs-primary) !important; }
.cursor-pointer:hover { cursor: pointer; }
.card.active { border-color: var(--bs-secondary); border-width: 3px; }

.drag-handle {
  user-select: none;
  font-weight: 700;
  padding: 2px 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--card);
  color: var(--text);
  
}
.drag-handle:hover { cursor: grab; }
.drag-ghost {
  opacity: 0.7;
  background: var(--card);
  border: 1px dashed var(--border);
}
.stop-name {
  color: var(--text);
  font-weight: 600;
}

.stop-address {
  font-size: 0.85em;
  color: var(--text);
  opacity: 0.7;
}


</style>

