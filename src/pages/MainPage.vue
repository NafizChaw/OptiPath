<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { MAX_SELECTABLE_ADDRESSES, WELCOME_MESSAGE } from "../constants";
import AddressComponent from "../components/AddressComponent.vue";
import MapComponent from "../components/MapComponent.vue";
import CategorySearch from "../components/CategorySearch.vue";
import type { SelectionState } from "../interfaces";
import { computeBestRoute, suggestBestDeparture } from "../algo/computeBestRoute";
import { addRefuelStops, estimateRefuelStops, type FuelConfig } from "../algo/fuelTracker";
import Draggable from "vuedraggable";
import LLMChat from "../components/LLMChat.vue";
import FuelSettings from "../components/FuelSettings.vue";

const selection_state = ref<SelectionState>({
  welcomeAcknowledged: false,
  startModeChosen: false,
  useCurrentLocation: false,
  addressSelectionCompleted: false,
  selectedAddresses: [],
  optimumRouteAddressOrder: null,
  travelMode: "Driving",
  routeOption: "Fastest",
  startIndex: 0,
});

const showWelcomeModal = ref(true);
const showSidebar = ref(true);
const departureTime = ref<Date | null>(new Date());
const useArrivalTime = ref(false);
const arrivalTime = ref<Date | null>(null);

const availableTransportationMethods = ["Driving", "Walking", "Bicycling"] as const;
type TravelModeUI = typeof availableTransportationMethods[number];

const canProceed = computed(() => selection_state.value.selectedAddresses.length >= 2);

const prereqsByUid = ref<Record<string, string[]>>({});
const finishUid = ref<string | null>(null);
const editingIndex = ref<number | null>(null);

function withUid<T extends Record<string, any>>(obj: T): T & { uid: string } {
  if ((obj as any)?.uid) return obj as any;
  const uid = (globalThis.crypto as any)?.randomUUID?.() || String(Date.now() + Math.random());
  return { ...obj, uid };
}

const fuelSettings = ref({
  enabled: false,
  currentFuelPercent: 75,
  tankCapacityGallons: 15,
  mpg: 25,
  refuelThresholdPercent: 25,
});

const fuelAnalysis = ref<{
  estimatedStops: number;
  totalDistance: number;
  actualStopsAdded: number;
  warnings: string[];
} | null>(null);


function normalizeForMatrix(a: any): string | google.maps.LatLngLiteral {
  if (a?.latLng) return a.latLng;
  if (a?.isCurrentLocation && a?.latLng) return a.latLng;
  return a?.formatted_address || a?.name || "";
}

function normalizeForFuel(a: any): string | google.maps.LatLngLiteral {
  if (a?.latLng) return a.latLng;
  return a?.formatted_address || a?.name || "";
}

const searchCenter = ref<{ lat: number; lng: number } | null>(null);
function refreshSearchCenterFromStops() {
  const cur = selection_state.value.selectedAddresses.find(a => a?.latLng);
  if (cur?.latLng) searchCenter.value = cur.latLng;
}
refreshSearchCenterFromStops();
watch(() => selection_state.value.selectedAddresses, refreshSearchCenterFromStops, { deep: true });

watch(
  () => selection_state.value.travelMode,
  (mode) => {
    if (mode !== "Driving") {
      fuelSettings.value.enabled = false;
    }
  },
  { immediate: true }
);

function handleCategorySelected(place: any) {
  const lat = place?.latLng?.lat ?? place?.geometry?.location?.lat?.();
  const lng = place?.latLng?.lng ?? place?.geometry?.location?.lng?.();
  const normalized = {
    formatted_address: place.formatted_address || place.name,
    name: place.name,
    ...(lat != null && lng != null ? { latLng: { lat, lng } } : {})
  };
  selection_state.value.selectedAddresses.push(withUid(normalized));
}

function addFromLLM(payload: { origin: any, stops: any[], finish?: any, constraints?: Array<[number, number]> }) {
  const w = (o: any) => withUid(o);
  const idxCur = selection_state.value.selectedAddresses.findIndex(a => a?.isCurrentLocation);

  if (payload.origin?.isCurrentLocation) {
    if (idxCur === -1) {
      selection_state.value.selectedAddresses.unshift(w(payload.origin));
      selection_state.value.startIndex = 0;
    } else {
      const existing = selection_state.value.selectedAddresses[idxCur];
      selection_state.value.selectedAddresses[idxCur] = { ...payload.origin, uid: existing?.uid ?? w(payload.origin).uid };
      selection_state.value.startIndex = idxCur;
    }
  } else if (payload.origin) {
    selection_state.value.selectedAddresses.unshift(w(payload.origin));
    selection_state.value.startIndex = 0;
  }

  const baseIndex = selection_state.value.selectedAddresses.length;
  for (const s of payload.stops) selection_state.value.selectedAddresses.push(w(s));

  if (payload.finish) {
    const f = w(payload.finish);
    selection_state.value.selectedAddresses.push(f);
    finishUid.value = f.uid;
  }

  if (payload.constraints?.length) {
    const added = selection_state.value.selectedAddresses.slice(baseIndex);
    const toUid = (i: number) => added[i]?.uid;
    for (const [beforeLocal, afterLocal] of payload.constraints) {
      const bUid = toUid(beforeLocal), aUid = toUid(afterLocal);
      if (!bUid || !aUid) continue;
      const arr = prereqsByUid.value[aUid] || [];
      if (!arr.includes(bUid)) arr.push(bUid);
      prereqsByUid.value[aUid] = arr;
    }
  }
  selection_state.value.optimumRouteAddressOrder = null;
}

function startEdit(i: number) { editingIndex.value = i; }
function cancelEdit() { editingIndex.value = null; }
function saveEditedAddress(newAddress: any, index: number) {
  selection_state.value.selectedAddresses[index] = withUid(newAddress);
  selection_state.value.optimumRouteAddressOrder = null;
  editingIndex.value = null;
}

const handleAddressSelected = (newAddress: any, index: number) => {
  selection_state.value.selectedAddresses[index] = withUid(newAddress);
  selection_state.value.optimumRouteAddressOrder = null;
};

const removeSelectedAddress = (index: number) => {
  const removed = selection_state.value.selectedAddresses.splice(index, 1)[0];
  if (removed?.uid) {
    if (finishUid.value === removed.uid) finishUid.value = null;
    for (const k of Object.keys(prereqsByUid.value)) {
      prereqsByUid.value[k] = (prereqsByUid.value[k] || []).filter(u => u !== removed.uid);
      if (!prereqsByUid.value[k].length) delete prereqsByUid.value[k];
    }
    delete prereqsByUid.value[removed.uid];
  }
  if (selection_state.value.startIndex > index) selection_state.value.startIndex--;
  selection_state.value.optimumRouteAddressOrder = null;
};

async function onReordered() {
  selection_state.value.optimumRouteAddressOrder = null;
}

async function useCurrentLocationAsOrigin() {
  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("No geolocation"));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    });

    const myLoc = withUid({
      formatted_address: "Current Location",
      isCurrentLocation: true,
      latLng: { lat: pos.coords.latitude, lng: pos.coords.longitude },
    });

    const idx = selection_state.value.selectedAddresses.findIndex(a => a?.isCurrentLocation);
    if (idx === -1) {
      selection_state.value.selectedAddresses.unshift(myLoc);
      selection_state.value.startIndex = 0;
    } else {
      const existing = selection_state.value.selectedAddresses[idx];
      selection_state.value.selectedAddresses[idx] = { ...myLoc, uid: existing?.uid ?? myLoc.uid };
      selection_state.value.startIndex = idx;
    }
    selection_state.value.useCurrentLocation = true;
  } catch {
    alert("Could not get current location. Please allow location access.");
  }
}

function setAsStartPoint(index: number) {
  selection_state.value.startIndex = index;
  selection_state.value.optimumRouteAddressOrder = null;
}

function toGMode(mode: string): google.maps.TravelMode {
  switch (mode) {
    case "Walking": return google.maps.TravelMode.WALKING;
    case "Bicycling": return google.maps.TravelMode.BICYCLING;
    default: return google.maps.TravelMode.DRIVING;
  }
}

function buildConstraintIndexes(stops: any[]) {
  const idOf: Record<string, number> = {};
  stops.forEach((s, i) => (idOf[s.uid] = i));
  const prerequisites: Record<number, number[]> = {};
  for (const [afterUid, befores] of Object.entries(prereqsByUid.value)) {
    if (!(afterUid in idOf)) continue;
    const afterIdx = idOf[afterUid];
    for (const b of befores || []) {
      if (b in idOf) (prerequisites[afterIdx] ||= []).push(idOf[b]);
    }
  }
  const endIndex = finishUid.value && finishUid.value in idOf ? idOf[finishUid.value] : undefined;
  return { prerequisites, endIndex };
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

function formatLocalDateTime(d: Date) {
  const tzOffsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function onDepartureChange(e: Event) {
  const target = e.target as HTMLInputElement | null;
  if (!target || !target.value) {
    departureTime.value = new Date();
    return;
  }
  departureTime.value = new Date(target.value);
}

function onArrivalChange(e: Event) {
  const target = e.target as HTMLInputElement | null;
  if (!target || !target.value) {
    arrivalTime.value = null;
    return;
  }
  arrivalTime.value = new Date(target.value);
}

const bestDepartureHint = ref<string | null>(null);
const isOptimizing = ref(false);

async function optimizeRoute() {
  const stops = selection_state.value.selectedAddresses;
  
  if (!stops || stops.length < 2) {
    alert("Please add at least 2 stops to optimize.");
    return;
  }

  console.log("\n🚀 ===== STARTING OPTIMIZATION =====");
  console.log("📍 Stops:", stops.length);
  console.log("🚗 Mode:", selection_state.value.travelMode);
  console.log("⛽ Fuel enabled:", fuelSettings.value.enabled);

  bestDepartureHint.value = null;
  fuelAnalysis.value = null;
  isOptimizing.value = true;
  selection_state.value.optimumRouteAddressOrder = null;

  try {
    await ensureGoogleLoaded();
    console.log("Google Maps loaded");

    const mode = toGMode(selection_state.value.travelMode);
    const { prerequisites, endIndex } = buildConstraintIndexes(stops);

    let effectiveDeparture = departureTime.value || new Date();

    if (useArrivalTime.value && arrivalTime.value) {
      const service = new google.maps.DistanceMatrixService();
      const response = await service.getDistanceMatrix({
        origins: [normalizeForMatrix(stops[0]) as any],
        destinations: [normalizeForMatrix(stops[stops.length - 1]) as any],
        travelMode: mode,
        drivingOptions: { departureTime: new Date() },
      });

      const durationSec =
        response.rows?.[0]?.elements?.[0]?.duration_in_traffic?.value ??
        response.rows?.[0]?.elements?.[0]?.duration?.value ??
        0;

      effectiveDeparture = new Date(arrivalTime.value.getTime() - durationSec * 1000);
      console.log("⏰ Adjusted departure for arrival-by:", effectiveDeparture);
    }

    console.log("🔄 Computing best route...");
    const { order } = await computeBestRoute(
      stops.map(normalizeForMatrix) as any,
      mode,
      {
        startIndex: selection_state.value.startIndex ?? 0,
        returnToStart: false,
        departureTime: effectiveDeparture,
        prerequisites,
        endIndex,
      }
    );
    console.log("Best route computed, order:", order);

    let finalOrder = order.map((i) => stops[i]);
    console.log("📋 Ordered stops:", finalOrder.map(s => s.name || s.formatted_address));

    if (fuelSettings.value.enabled && mode === google.maps.TravelMode.DRIVING) {
      console.log("\n⛽ ===== FUEL TRACKING ENABLED =====");
      console.log("Current settings:", {
        fuel: fuelSettings.value.currentFuelPercent + "%",
        tank: fuelSettings.value.tankCapacityGallons + " gal",
        mpg: fuelSettings.value.mpg,
        threshold: fuelSettings.value.refuelThresholdPercent + "%",
        currentRange: ((fuelSettings.value.currentFuelPercent/100) * fuelSettings.value.tankCapacityGallons * fuelSettings.value.mpg).toFixed(1) + " mi"
      });

      const cfg: FuelConfig = {
        currentFuelPercent: fuelSettings.value.currentFuelPercent,
        tankCapacityGallons: fuelSettings.value.tankCapacityGallons,
        mpg: fuelSettings.value.mpg,
        refuelThresholdPercent: fuelSettings.value.refuelThresholdPercent,
      };

      const routeAddresses = finalOrder.map(normalizeForFuel);
      console.log("📍 Route addresses for fuel calc:", routeAddresses.map(a => 
        typeof a === 'object' ? `${a.lat.toFixed(4)}, ${a.lng.toFixed(4)}` : a
      ));

      try {
        const routeWithFuel = await addRefuelStops(routeAddresses, cfg, mode);
        
        console.log("\n✅ Fuel tracking complete!");
        console.log("Results:", {
          totalDistance: routeWithFuel.totalDistance.toFixed(1) + " mi",
          originalStops: finalOrder.length,
          totalStops: routeWithFuel.stops.length,
          gasStations: routeWithFuel.stops.filter(s => s.isRefuelStop).length,
          warnings: routeWithFuel.warnings.length
        });

        if (routeWithFuel.warnings.length > 0) {
          console.log("⚠️  Warnings:");
          routeWithFuel.warnings.forEach(w => console.log("   -", w));
        }

        const stitched = routeWithFuel.stops.map((s) => {
          if (s.isRefuelStop) {
            console.log("🏁 Adding gas station to route");
            return {
              name: "⛽ Gas Station",
              formatted_address: typeof s.address === "string" 
                ? s.address 
                : `${s.address.lat}, ${s.address.lng}`,
              latLng: typeof s.address === "object" ? s.address : undefined,
              isRefuelStop: true,
              fuelLevelAfter: s.fuelLevelAfter,
              uid: withUid({}).uid,
            };
          }
          
          const original = finalOrder.find((o) => {
            const n = normalizeForFuel(o);
            if (typeof n === "object" && typeof s.address === "object") {
              return Math.abs(n.lat - s.address.lat) < 0.0001 && 
                     Math.abs(n.lng - s.address.lng) < 0.0001;
            }
            return n === s.address;
          });
          
          if (!original) {
            console.warn("⚠️  Could not match stop:", s.address);
            return {
              name: "Unknown Stop",
              formatted_address: typeof s.address === "string" ? s.address : "Unknown",
              latLng: typeof s.address === "object" ? s.address : undefined,
              fuelLevelAfter: s.fuelLevelAfter,
              uid: withUid({}).uid,
            };
          }
          
          return { ...original, fuelLevelAfter: s.fuelLevelAfter };
        });

        finalOrder = stitched;
        
        fuelAnalysis.value = {
          estimatedStops: estimateRefuelStops(routeWithFuel.totalDistance, cfg),
          totalDistance: routeWithFuel.totalDistance,
          actualStopsAdded: routeWithFuel.stops.filter(x => x.isRefuelStop).length,
          warnings: routeWithFuel.warnings,
        };

        console.log("📊 Fuel analysis set:", fuelAnalysis.value);
      } catch (fuelError) {
        console.error("❌ FUEL TRACKING ERROR:", fuelError);
        alert("Fuel tracking failed: " + (fuelError as Error).message + "\n\nCheck console for details.");
      }
    } else {
      console.log("⏭️  Skipping fuel tracking (not enabled or not driving)");
    }

    console.log("\n📋 Final route has", finalOrder.length, "stops");
    selection_state.value.optimumRouteAddressOrder = finalOrder;

    try {
      const addresses = finalOrder.map(normalizeForMatrix);
      const hint = await suggestBestDeparture(addresses as any, mode, [0, 15, 30], {
        startIndex: selection_state.value.startIndex ?? 0,
        returnToStart: false,
        prerequisites,
        endIndex,
      });
      bestDepartureHint.value =
        hint.bestOffsetMin > 0
          ? `Tip: leaving in ${hint.bestOffsetMin} min may be faster (≈ ${Math.round(hint.bestSeconds / 60)} min total).`
          : `Leaving now is best (≈ ${Math.round(hint.bestSeconds / 60)} min total).`;
    } catch { 
      console.log("⏭️  Skipping departure hint");
    }

    console.log("✅ ===== OPTIMIZATION COMPLETE =====\n");
  } catch (e) {
    console.error("❌ OPTIMIZATION FAILED:", e);
    alert("Optimization failed: " + (e as Error).message + "\n\nPlease check:\n- Google Maps API key\n- Places API enabled\n- Distance Matrix API enabled\n- Billing enabled");
    selection_state.value.optimumRouteAddressOrder = null;
  } finally {
    isOptimizing.value = false;
  }
}

function googleMapsLink(addresses: any[], mode: string): string {
  if (!addresses || addresses.length < 2) return "#";
  const base = "https://www.google.com/maps/dir/?api=1";
  const fmt = (a:any) =>
    a?.latLng ? `${a.latLng.lat},${a.latLng.lng}`
    : a?.isCurrentLocation && a?.latLng ? "My+Location"
    : encodeURIComponent(a.formatted_address || "");
  const origin = fmt(addresses[0]);
  const destination = fmt(addresses[addresses.length - 1]);
  const waypoints = addresses.slice(1, -1).map(fmt).join("|") || "";
  const travelmode = mode.toLowerCase();
  return `${base}&origin=${origin}&destination=${destination}${waypoints ? `&waypoints=${waypoints}` : ""}&travelmode=${travelmode}`;
}

function appleMapsLink(addresses: any[], mode: string): string {
  if (!addresses || addresses.length < 2) return "#";
  const fmt = (a: any) =>
    a?.latLng ? `${a.latLng.lat},${a.latLng.lng}`
    : encodeURIComponent(a.formatted_address || a.name || "");
  const origin = fmt(addresses[0]);
  const destination = fmt(addresses[addresses.length - 1]);
  const waypoints = addresses.slice(1, -1).map(fmt).join(" to ");
  const dirflg = mode === "Walking" ? "w" : mode === "Bicycling" ? "b" : "d";
  let daddr = waypoints ? `${waypoints} to ${destination}` : destination;
  return `https://maps.apple.com/?saddr=${origin}&daddr=${daddr}&dirflg=${dirflg}`;
}

function dismissWelcome() {
  showWelcomeModal.value = false;
  selection_state.value.welcomeAcknowledged = true;
}
</script>

<template>
  <div class="map-container">
    <MapComponent
      :addresses="Array.isArray(selection_state.optimumRouteAddressOrder) && selection_state.optimumRouteAddressOrder.length > 1
        ? (selection_state.optimumRouteAddressOrder as any[])
        : selection_state.selectedAddresses"
      :travelMode="selection_state.travelMode"
    />
  </div>

  <div v-if="showWelcomeModal" class="modal-overlay" @click.self="dismissWelcome">
    <div class="welcome-modal">
      <button class="close-btn" @click="dismissWelcome">&times;</button>
      <h2>Welcome to OptiPath</h2>
      <p>{{ WELCOME_MESSAGE }}</p>
      <button class="btn btn-primary btn-lg mt-3" @click="dismissWelcome">Get Started</button>
    </div>
  </div>

  <div class="sidebar" :class="{ collapsed: !showSidebar }">
    <button class="sidebar-toggle" @click="showSidebar = !showSidebar">
      {{ showSidebar ? '‹' : '›' }}
    </button>

    <div v-if="showSidebar" class="sidebar-content">
      <div class="sidebar-header">
        <h3>Plan Your Route</h3>
        <div class="stop-count">{{ selection_state.selectedAddresses.length }} / {{ MAX_SELECTABLE_ADDRESSES }} stops</div>
      </div>

      <div class="mode-selector">
        <button
          v-for="mode in availableTransportationMethods"
          :key="mode"
          class="mode-btn"
          :class="{ active: selection_state.travelMode === mode }"
          @click="selection_state.travelMode = mode">
          <span v-if="mode === 'Driving'">🚗</span>
          <span v-else-if="mode === 'Walking'">🚶</span>
          <span v-else>🚴</span>
          {{ mode }}
        </button>
      </div>

      <div class="quick-actions">
        <button class="action-btn" @click="useCurrentLocationAsOrigin">Use My Location</button>
      </div>

      <div class="section">
        <LLMChat @resolvedStops="addFromLLM" />
      </div>

      <div class="section" v-if="selection_state.travelMode === 'Driving'">
        <FuelSettings v-model="fuelSettings" />
      </div>

      <div class="stops-section">
        <h5>Your Stops</h5>

        <Draggable
          v-model="selection_state.selectedAddresses"
          item-key="uid"
          handle=".drag-handle"
          @end="onReordered"
          class="stops-list"
          :animation="180"
          ghost-class="drag-ghost">
          <template #item="{ element, index }">
            <div class="stop-card">
              <div class="stop-header">
                <span class="drag-handle">⋮⋮</span>
                <div class="stop-number">
                  <span v-if="index === selection_state.startIndex" class="badge-start">START</span>
                  <span v-else-if="finishUid === element.uid" class="badge-end">END</span>
                  <span v-else>{{ index + 1 }}</span>
                </div>
                <div class="stop-info">
                  <div class="stop-name">
                    <span v-if="element.isRefuelStop">⛽︎ </span>
                    {{ element.name || element.formatted_address }}
                  </div>
                  <div v-if="element.fuelLevelAfter !== undefined" class="fuel-indicator">
                    {{ element.fuelLevelAfter.toFixed(0) }}%
                  </div>
                </div>
              </div>

              <div class="stop-actions">
                <button v-if="index !== selection_state.startIndex" class="icon-btn" @click="setAsStartPoint(index)" title="Set as start">Start</button>
                <button class="icon-btn" :class="{ active: finishUid === element.uid }" @click="finishUid = finishUid === element.uid ? null : element.uid" title="Set as end">End</button>
                <button v-if="!element?.isCurrentLocation && !element?.isRefuelStop" class="icon-btn delete" @click="removeSelectedAddress(index)" title="Remove">Remove</button>
              </div>

              <div v-if="editingIndex === index" class="mt-2">
                <AddressComponent @addressSelected="(addr:any) => saveEditedAddress(addr, index)" />
                <div class="mt-2">
                  <button class="btn btn-secondary btn-sm" @click="cancelEdit">Cancel</button>
                </div>
              </div>
            </div>
          </template>
        </Draggable>

        <div v-if="selection_state.selectedAddresses.length < MAX_SELECTABLE_ADDRESSES" class="add-stop">
          <AddressComponent @addressSelected="handleAddressSelected($event, selection_state.selectedAddresses.length)" />
        </div>

        <div class="category-search-section">
          <CategorySearch
            :center="searchCenter"
            :radiusMeters="5000"
            placeholder="Find gas stations, groceries, etc."
            @select="handleCategorySelected"
            :showLabel="false" />
        </div>
      </div>

      <div v-if="fuelAnalysis && fuelSettings.enabled" class="fuel-analysis">
        <h6>Fuel Analysis</h6>
        <div class="analysis-grid">
          <div>Distance: {{ fuelAnalysis.totalDistance.toFixed(1) }} mi</div>
          <div>Gas Stops: {{ fuelAnalysis.actualStopsAdded }}</div>
        </div>
        <div v-for="(warning, idx) in fuelAnalysis.warnings" :key="idx" class="warning">⚠️ {{ warning }}</div>
      </div>

      <div class="section departure-time" v-if="selection_state.travelMode === 'Driving'">
        <div class="toggle-row">
          <label>
            <input type="checkbox" v-model="useArrivalTime" />
            Set Arrival Time Instead
          </label>
        </div>

        <div v-if="useArrivalTime">
          <h6>Arrive By</h6>
          <input
            type="datetime-local"
            class="time-input"
            :value="arrivalTime ? formatLocalDateTime(arrivalTime) : ''"
            @change="onArrivalChange"
          />
          <small class="muted">We'll estimate when to leave to arrive on time.</small>
        </div>
        <div v-else>
          <h6>Leave At</h6>
          <input
            type="datetime-local"
            class="time-input"
            :value="departureTime ? formatLocalDateTime(departureTime) : ''"
            @change="onDepartureChange"
          />
          <small class="muted">Used to calculate real-time traffic for driving routes.</small>
        </div>
      </div>

      <div v-if="bestDepartureHint" class="hint-box">
        💡 {{ bestDepartureHint }}
      </div>

      <div
        v-if="Array.isArray(selection_state.optimumRouteAddressOrder) && selection_state.optimumRouteAddressOrder.length > 1"
        class="export-actions"
      >
        <a
          class="export-btn google"
          :href="googleMapsLink(selection_state.optimumRouteAddressOrder as any[], selection_state.travelMode)"
          target="_blank"
        >
          Open in Google Maps
        </a>

        <a
          class="export-btn apple"
          :href="appleMapsLink(selection_state.optimumRouteAddressOrder as any[], selection_state.travelMode)"
          target="_blank"
        >
          Open in Apple Maps
        </a>
      </div>
    </div>

    <div class="step-footer" v-if="showSidebar">
      <button class="footer-btn secondary"
              v-if="selection_state.addressSelectionCompleted"
              @click="selection_state.addressSelectionCompleted = false">← Back</button>

      <button class="footer-btn primary"
              v-else
              :disabled="!canProceed"
              @click="selection_state.addressSelectionCompleted = true">Next →</button>

      <button class="footer-btn accent"
              v-if="selection_state.addressSelectionCompleted"
              :disabled="!canProceed || isOptimizing"
              @click="optimizeRoute">{{ isOptimizing ? 'Optimizing…' : 'Optimize' }}</button>
    </div>
  </div>
</template>

<style scoped>
.map-container { position: fixed; inset: 0; z-index: 0; }

.modal-overlay{
  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center;
  background: rgba(0,0,0,.62);
  backdrop-filter: blur(4px);
}
.welcome-modal{
  position: relative;
  width: min(600px, 92vw);
  padding: 2rem;
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 18px 48px rgba(0,0,0,.35);
}
.close-btn{
  position: absolute; inset: 0 0 auto auto;
  margin: .75rem;
  appearance: none; border: 0; background: transparent;
  font-size: 1.75rem; line-height: 1; cursor: pointer;
  color: var(--text); opacity: .65; transition: opacity .2s ease;
}
.close-btn:hover{ opacity: 1; }
.welcome-modal h2{ margin: 0 0 .5rem; color: var(--text); }
.welcome-modal p{ margin: 0; color: var(--muted); line-height: 1.6; }

.sidebar{
  position: fixed; inset: 0 0 0 auto; width: 420px; height: 100vh;
  z-index: 1000;
  background: var(--card);
  border-left: 1px solid var(--border);
  box-shadow: -4px 0 20px rgba(0,0,0,.08);
  transition: transform .3s ease;
  overflow-y: auto;
}
.sidebar.collapsed{ transform: translateX(420px); }
.sidebar-toggle{
  position: absolute; left: -40px; top: 50%; transform: translateY(-50%);
  width: 40px; height: 80px;
  display: grid; place-items: center;
  border-radius: 8px 0 0 8px;
  border: 1px solid var(--border); border-right: 0;
  background: var(--card); color: var(--text);
  font-size: 1.25rem; cursor: pointer;
  box-shadow: -4px 0 16px rgba(0,0,0,.06);
}
.sidebar-content{ padding: 1.25rem; padding-bottom: 100px; }
.sidebar-header{
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 1rem;
}
.sidebar-header h3{ margin: 0; font-size: 1.25rem; color: var(--text); }
.stop-count{
  font-size: .85rem; color: var(--muted);
  background: var(--bg); padding: .25rem .6rem; border-radius: 999px;
  border: 1px solid var(--border);
}

.mode-selector{ display: grid; grid-template-columns: repeat(3,1fr); gap: .5rem; margin-bottom: 1rem; }
.mode-btn{
  padding: .65rem .75rem; border-radius: 10px; font-weight: 600; cursor: pointer;
  border: 1.5px solid var(--border); background: var(--bg); color: var(--text);
  transition: border-color .2s ease, transform .06s ease;
}
.mode-btn:hover{ border-color: var(--accent); }
.mode-btn:active{ transform: translateY(1px); }
.mode-btn.active{ background: var(--accent); border-color: var(--accent); color: #fff; }

.quick-actions{ display: grid; grid-template-columns: 1fr; gap: .5rem; margin-bottom: 1rem; }
.action-btn{
  padding: .55rem .7rem; border-radius: 10px; cursor: pointer; font-size: .95rem;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  transition: border-color .2s ease, background .2s ease;
}
.action-btn:hover{ border-color: var(--accent); background: rgba(0,0,0,.02); }

.section{ margin-bottom: 1rem; }

.stops-section{ margin: 1.25rem 0; }
.stops-section h5{ margin: 0 0 .65rem; font-size: 1.05rem; color: var(--text); }

.stops-list{
  display: flex; flex-direction: column; gap: .65rem;
  margin-bottom: 1rem; max-height: 420px; overflow-y: auto;
}
.stop-card{
  padding: .75rem; border-radius: 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  transition: box-shadow .2s ease, border-color .2s ease, transform .06s ease;
}
.stop-card:hover{ border-color: var(--accent); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
.stop-header{ display: flex; align-items: center; gap: .65rem; margin-bottom: .4rem; }
.drag-handle{
  user-select: none; cursor: grab; font-weight: 700;
  color: var(--muted); padding: 2px 6px; border-radius: 6px;
  border: 1px dashed var(--border); background: var(--card);
}
.drag-handle:active{ cursor: grabbing; }
.stop-number{ min-width: 52px; font-weight: 700; color: var(--accent); }
.badge-start,.badge-end{
  display: inline-block; padding: .22rem .5rem; border-radius: 6px;
  font-size: .72rem; font-weight: 700; color: #fff; background: var(--accent);
}
.badge-end{ background: #ef4444; }
.stop-info{ flex: 1; min-width: 0; }
.stop-name{ font-weight: 600; color: var(--text); margin-bottom: .15rem; }
.fuel-indicator{ font-size: .85rem; color: var(--muted); }

.stop-actions{ display: flex; gap: .4rem; justify-content: flex-end; }
.icon-btn{
  padding: .4rem .6rem; border-radius: 8px; font-size: .95rem; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  transition: border-color .2s ease, transform .06s ease, background .2s ease;
}
.icon-btn:hover{ border-color: var(--accent); transform: translateY(-1px); }
.icon-btn.active{ background: var(--accent); border-color: var(--accent); color: #fff; }
.icon-btn.delete:hover{ border-color: #ef4444; background: rgba(239,68,68,.08); }

.drag-ghost{ opacity: .6; background: var(--accent); }

.add-stop{ margin-bottom: 1rem; }
.category-search-section{ margin-top: 1rem; }

.fuel-analysis{
  padding: .9rem; border-radius: 12px;
  background: var(--bg); border: 1px solid var(--border);
  margin-bottom: 1rem;
}
.fuel-analysis h6{ margin: 0 0 .4rem; font-weight: 600; color: var(--text); }
.analysis-grid{ display: grid; grid-template-columns: 1fr 1fr; gap: .4rem; font-size: .92rem; color: var(--text); }
.warning{ margin-top: .4rem; font-size: .85rem; color: #f59e0b; }

.hint-box{
  padding: .75rem; border-radius: 10px;
  background: var(--bg); border: 1px solid var(--accent);
  color: var(--text); font-size: .9rem;
  margin-bottom: 1rem;
}

.step-footer{
  position: fixed; right: 16px; bottom: 16px; z-index: 1100;
  display: flex; gap: .5rem; flex-wrap: wrap;
}
.footer-btn{
  padding: .65rem 1rem; border-radius: 10px; font-weight: 700; cursor: pointer;
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  transition: transform .06s ease, border-color .2s ease;
}
.footer-btn:disabled{ opacity: .55; cursor: not-allowed; }
.footer-btn.primary{ background: var(--bg); }
.footer-btn.accent{ background: var(--accent); color: #fff; border-color: var(--accent); }
.footer-btn.secondary{ opacity: .9; }
.footer-btn:hover:not(:disabled){ transform: translateY(-1px); }

.departure-time{
  margin: 1rem 0; padding: .75rem 1rem; border-radius: 10px;
  background: var(--bg); border: 1px solid var(--border);
}
.departure-time h6{ margin: 0 0 .5rem; font-weight: 600; color: var(--text); }
.time-input{
  width: 100%; padding: .5rem .6rem; border-radius: 8px;
  border: 1px solid var(--border); background: var(--card); color: var(--text);
  transition: border-color .2s ease, box-shadow .2s ease;
}
.time-input:focus{
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent);
}
.muted{ color: var(--muted); font-size: .85rem; }
.toggle-row{
  display: flex; align-items: center; gap: .5rem;
  margin-bottom: .5rem; font-size: .92rem; color: var(--text);
}

.export-actions{ display: grid; gap: .5rem; margin-bottom: 1rem; }
.export-btn{
  display: block; text-align: center; font-weight: 600; text-decoration: none;
  padding: .7rem; border-radius: 10px; transition: transform .06s ease, filter .2s ease;
}
.export-btn:hover{ transform: translateY(-1px); filter: brightness(.98); }
.export-btn.google{ background: #4285f4; color: #fff; }
.export-btn.google:hover{ filter: brightness(.95); }
.export-btn.apple{ background: #000; color: #fff; }
.export-btn.apple:hover{ filter: brightness(.92); }

@media (max-width: 768px){
  .sidebar{
    width: 100%; height: 62vh; inset: auto 0 0 0;
    border-left: 0; border-top: 1px solid var(--border);
    border-radius: 18px 18px 0 0;
  }
  .sidebar.collapsed{ transform: translateY(calc(62vh - 56px)); }
  .sidebar-toggle{
    left: 50%; top: -40px; transform: translate(-50%, 0);
    width: 88px; height: 40px; border-radius: 10px 10px 0 0; border-bottom: 0;
  }
  .welcome-modal{ width: 94%; padding: 1.5rem; }
}

@media (prefers-reduced-motion: reduce){
  *{ transition: none !important; }
}
</style>