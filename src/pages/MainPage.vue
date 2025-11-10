<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { MAX_SELECTABLE_ADDRESSES, WELCOME_MESSAGE_SHORT, WELCOME_MESSAGE_FULL } from "../constants";
import AddressComponent from "../components/AddressComponent.vue";
import MapComponent from "../components/MapComponent.vue";
import CategorySearch from "../components/CategorySearch.vue";
import type { SelectionState } from "../interfaces";
import { computeBestRoute, suggestBestDeparture } from "../algo/computeBestRoute";
import { addRefuelStops, estimateRefuelStops, type FuelConfig } from "../algo/fuelTracker";
import Draggable from "vuedraggable";
import LLMChat from "../components/LLMChat.vue";
import FuelSettings from "../components/FuelSettings.vue";

const props = defineProps<{ theme?: 'light' | 'dark' }>();
const emit = defineEmits<{ (e: 'toggleTheme'): void }>();

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

const preOptimizationOrder = ref<any[] | null>(null);

const showWelcomeModal = ref(true);
const showFullInfo = ref(false);
const showSidebar = ref(true);
const departureTime = ref<Date | null>(new Date());
const useArrivalTime = ref(false);
const arrivalTime = ref<Date | null>(null);

const availableTransportationMethods = ["Driving", "Walking", "Bicycling"] as const;

const canProceed = computed(() => selection_state.value.selectedAddresses.length >= 2);

const prereqsByUid = ref<Record<string, string[]>>({});
const finishUid = ref<string | null>(null);
const editingIndex = ref<number | null>(null);

const showLockModal = ref(false);
const selectedLockStop = ref<any | null>(null);

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

const totalTravelTime = computed(() => {
  const addresses = selection_state.value.optimumRouteAddressOrder || 
                   selection_state.value.selectedAddresses;
  
  if (!addresses || addresses.length < 2) return 0;
  
  return addresses.reduce((total: number, stop: any) => {
    return total + (stop.travelTimeToNext || 0);
  }, 0);
});

const totalTravelDistance = computed(() => {
  const addresses = selection_state.value.optimumRouteAddressOrder || 
                   selection_state.value.selectedAddresses;
  
  if (!addresses || addresses.length < 2) return 0;
  
  return addresses.reduce((total: number, stop: any) => {
    return total + (stop.distanceToNext || 0);
  }, 0);
});


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
const isOptimized = ref(false);

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return remainMins > 0 ? `${hours}h ${remainMins}m` : `${hours}h`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${meters.toFixed(0)}m` : `${miles.toFixed(1)} mi`;
}

async function optimizeRoute() {
  const stops = selection_state.value.selectedAddresses;
  
  if (!stops || stops.length < 2) {
    alert("Please add at least 2 stops to optimize.");
    return;
  }

  preOptimizationOrder.value = JSON.parse(JSON.stringify(stops));

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

    console.log("⏱️ Calculating travel times between stops...");
    const distanceService = new google.maps.DistanceMatrixService();

    for (let i = 0; i < finalOrder.length - 1; i++) {
      try {
        const response = await distanceService.getDistanceMatrix({
          origins: [normalizeForMatrix(finalOrder[i]) as any],
          destinations: [normalizeForMatrix(finalOrder[i + 1]) as any],
          travelMode: mode,
          ...(mode === google.maps.TravelMode.DRIVING ? {
            drivingOptions: { departureTime: effectiveDeparture }
          } : {}),
        });

        const element = response.rows?.[0]?.elements?.[0];
        if (element?.status === 'OK') {
          (finalOrder[i] as any).travelTimeToNext = 
            element.duration_in_traffic?.value ?? element.duration?.value ?? 0;
          (finalOrder[i] as any).distanceToNext = element.distance?.value ?? 0;
          console.log(`  Stop ${i} → ${i+1}: ${formatDuration((finalOrder[i] as any).travelTimeToNext!)} (${formatDistance((finalOrder[i] as any).distanceToNext!)})`);
        }
      } catch (error) {
        console.warn(`Could not get travel time for stop ${i}:`, error);
      }
    }

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
          console.log("⚠️ Warnings:");
          routeWithFuel.warnings.forEach(w => console.log("   -", w));
        }

        const stitched = routeWithFuel.stops.map((s) => {
          if (s.isRefuelStop) {
            console.log("⛽ Adding gas station to route");
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
            console.warn("⚠️ Could not match stop:", s.address);
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
      console.log("⭐️ Skipping fuel tracking (not enabled or not driving)");
    }

    console.log("\n📋 Final route has", finalOrder.length, "stops");
    selection_state.value.optimumRouteAddressOrder = finalOrder;
    
    selection_state.value.selectedAddresses = [...finalOrder];
    
    const startStop = finalOrder[0];
    selection_state.value.startIndex = 0;

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
      console.log("⭐️ Skipping departure hint");
    }

    console.log("✅ ===== OPTIMIZATION COMPLETE =====\n");
    isOptimized.value = true;
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

function openLockModal(stop: any) {
  selectedLockStop.value = stop;
  showLockModal.value = true;
}

function closeLockModal() {
  selectedLockStop.value = null;
  showLockModal.value = false;
}

function getPrerequisitesFor(uid: string) {
  return (prereqsByUid.value[uid] || [])
    .map(prereqUid => selection_state.value.selectedAddresses.find(s => s.uid === prereqUid))
    .filter(Boolean);
}

function getDependentsOf(uid: string) {
  return Object.entries(prereqsByUid.value)
    .filter(([_, befores]) => befores.includes(uid))
    .map(([afterUid]) => selection_state.value.selectedAddresses.find(s => s.uid === afterUid))
    .filter(Boolean);
}

function hasLocks(uid: string) {
  const hasPrereqs = (prereqsByUid.value[uid] || []).length > 0;
  const isDependency = Object.values(prereqsByUid.value).some(arr => arr.includes(uid));
  return hasPrereqs || isDependency;
}

function wouldCreateCycle(startUid: string, endUid: string): boolean {
  const visited = new Set<string>();
  const queue = [startUid];
  
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === endUid) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    
    Object.entries(prereqsByUid.value).forEach(([afterUid, befores]) => {
      if (befores.includes(current)) {
        queue.push(afterUid);
      }
    });
  }
  return false;
}

function togglePrerequisite(afterUid: string, beforeUid: string) {
  const current = prereqsByUid.value[afterUid] || [];
  const exists = current.includes(beforeUid);
  
  if (exists) {
    const filtered = current.filter(id => id !== beforeUid);
    if (filtered.length === 0) {
      const copy = { ...prereqsByUid.value };
      delete copy[afterUid];
      prereqsByUid.value = copy;
    } else {
      prereqsByUid.value = { ...prereqsByUid.value, [afterUid]: filtered };
    }
  } else {
    if (wouldCreateCycle(beforeUid, afterUid)) {
      alert('Cannot create this lock: it would create a circular dependency!');
      return;
    }
    prereqsByUid.value = { ...prereqsByUid.value, [afterUid]: [...current, beforeUid] };
  }
  
  selection_state.value.optimumRouteAddressOrder = null;
}

function isPrerequisiteSelected(afterUid: string, beforeUid: string): boolean {
  return (prereqsByUid.value[afterUid] || []).includes(beforeUid);
}

function restoreOriginalOrder() {
  if (preOptimizationOrder.value) {
    selection_state.value.selectedAddresses = JSON.parse(JSON.stringify(preOptimizationOrder.value));
    selection_state.value.optimumRouteAddressOrder = null;
    isOptimized.value = false;
    preOptimizationOrder.value = null;
    
    // Find and restore original start index
    const originalStart = selection_state.value.selectedAddresses.findIndex((s, i) => 
      i === 0 || s.isCurrentLocation
    );
    if (originalStart !== -1) {
      selection_state.value.startIndex = originalStart;
    }
  }
}
</script>

<template>
  <div class="app-wrapper">
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
    <p>{{ showFullInfo ? WELCOME_MESSAGE_FULL : WELCOME_MESSAGE_SHORT }}</p>

    <div class="button-row">
      <button
        class="btn btn-primary"
        @click="showFullInfo = !showFullInfo"
      >
        {{ showFullInfo ? 'Show Less' : 'More Details' }}
      </button>
      <button class="btn btn-primary accent" @click="dismissWelcome">
        Get Started
      </button>
    </div>
  </div>
</div>


    <div class="sidebar" :class="{ collapsed: !showSidebar }">
      <button class="sidebar-toggle" @click="showSidebar = !showSidebar">
        {{ showSidebar ? '‹' : '›' }}
      </button>

      <div v-if="showSidebar" class="sidebar-content">
        <!-- Mini Header with Logo and Theme Toggle -->
        <div class="sidebar-mini-header">
          <div class="logo-section">
            <img
              class="mini-logo"
              src="/src/assets/images/logo-bg-tp.png"
              alt="OptiPath"
            />
            <!-- <span class="brand-name">OptiPath</span> -->
          </div>
          <button
            class="theme-toggle-mini"
            @click="emit('toggleTheme')"
            :title="props.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'"
          >
            <span v-if="props.theme === 'dark'">☀️</span>
            <span v-else>🌙</span>
          </button>
        </div>

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

        

        <div class="section">
          <LLMChat @resolvedStops="addFromLLM" />
        </div>

        <div class="section" v-if="selection_state.travelMode === 'Driving'">
          <FuelSettings v-model="fuelSettings" />
        </div>

        <div class="stops-section">
          <h5>Your Stops</h5>
          <div class="quick-actions">
          <button class="action-btn" @click="useCurrentLocationAsOrigin">Use My Location</button>
        </div>

          <Draggable
            v-model="selection_state.selectedAddresses"
            item-key="uid"
            handle=".drag-handle"
            @end="onReordered"
            class="stops-list"
            :animation="180"
            ghost-class="drag-ghost">
            <template #item="{ element, index }">
              <div class="stop-card" :class="{ 'has-locks': hasLocks(element.uid) }">
                <div class="stop-header">
                  <span class="drag-handle">⋮⋮</span>
                  <div class="stop-number">
                    <span v-if="index === selection_state.startIndex" class="badge-start">START</span>
                    <span v-else-if="finishUid === element.uid" class="badge-end">END</span>
                    <span v-else>{{ index + 1 }}</span>
                  </div>
                  <div class="stop-info">
                    <div class="stop-name">
                      <span v-if="element.isRefuelStop">⛽️ </span>
                      <span v-if="hasLocks(element.uid)">🔒 </span>
                      {{ element.name || element.formatted_address }}
                    </div>
                    <div v-if="element.fuelLevelAfter !== undefined" class="fuel-indicator">
                      {{ element.fuelLevelAfter.toFixed(0) }}%
                    </div>
                  </div>
                </div>

                <!-- NEW: Travel time to next stop -->
                <div 
                  v-if="element.travelTimeToNext !== undefined && index < selection_state.selectedAddresses.length - 1" 
                  class="travel-info"
                >
                  <div class="travel-arrow">↓</div>
                  <div class="travel-details">
                    <span class="travel-time">⏱️ {{ formatDuration(element.travelTimeToNext) }}</span>
                    <span class="travel-distance">📍 {{ formatDistance(element.distanceToNext) }}</span>
                  </div>
                </div>

                <!-- Prerequisites display -->
                <div v-if="getPrerequisitesFor(element.uid).length > 0" class="prereqs-display">
                  <div class="prereqs-label">📌 Must happen AFTER:</div>
                  <div class="prereqs-tags">
                    <span v-for="prereq in getPrerequisitesFor(element.uid)" :key="prereq?.uid || ''" class="prereq-tag">
                      {{ prereq?.name || prereq?.formatted_address || 'Unknown' }}
                    </span>
                  </div>
                </div>

                <!-- Dependents display -->
                <div v-if="getDependentsOf(element.uid).length > 0" class="dependents-display">
                  <div class="dependents-label">🔗 Must happen BEFORE:</div>
                  <div class="dependents-tags">
                    <span v-for="dep in getDependentsOf(element.uid)" :key="dep?.uid || ''" class="dependent-tag">
                      {{ dep?.name || dep?.formatted_address || 'Unknown' }}
                    </span>
                  </div>
                </div>

                <div class="stop-actions">
                  <button v-if="index !== selection_state.startIndex" class="icon-btn" @click="setAsStartPoint(index)" title="Set as start">Start</button>
                  <button class="icon-btn" :class="{ active: finishUid === element.uid }" @click="finishUid = finishUid === element.uid ? null : element.uid" title="Set as end">End</button>
                  <button class="icon-btn lock-btn" :class="{ active: hasLocks(element.uid) }" @click="openLockModal(element)" title="Lock order">
                    <span v-if="hasLocks(element.uid)">🔒</span>
                    <span v-else>🔓</span>
                    Lock
                  </button>
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
              placeholder="Find by category (e.g., 'coffee')"
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

        <!-- NEW: Total Time Summary -->
        <div 
          v-if="totalTravelTime > 0" 
          class="total-time-summary"
        >
          <div class="label">Total Travel Time</div>
          <div class="value">{{ formatDuration(totalTravelTime) }}</div>
          <div class="label" style="margin-top: 0.5rem;">Total Distance</div>
          <div class="value" style="font-size: 1.2rem;">{{ formatDistance(totalTravelDistance) }}</div>
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
        <button 
          v-if="isOptimized"
          class="footer-btn secondary"
          @click="restoreOriginalOrder"
        >
          ↺ Restore Original Order
        </button>

        <button class="footer-btn secondary"
                v-if="selection_state.addressSelectionCompleted && !isOptimized"
                @click="selection_state.addressSelectionCompleted = false">← Back</button>

        <button class="footer-btn primary"
                v-else-if="!isOptimized"
                :disabled="!canProceed"
                @click="selection_state.addressSelectionCompleted = true">Next →</button>

        <button class="footer-btn accent"
                v-if="selection_state.addressSelectionCompleted"
                :disabled="!canProceed || isOptimizing"
                @click="optimizeRoute">{{ isOptimizing ? 'Optimizing…' : 'Optimize' }}</button>
      </div>
    </div>

    <!-- Priority Lock Modal -->
    <div v-if="showLockModal && selectedLockStop" class="modal-overlay" @click.self="closeLockModal">
      <div class="lock-modal card">
        <div class="lock-modal-header">
          <h4>🔒 Lock Order for: <span class="highlight">{{ selectedLockStop.name || selectedLockStop.formatted_address }}</span></h4>
          <button class="close-btn" @click="closeLockModal">&times;</button>
        </div>

        <p class="lock-modal-description">
          Select stops that must happen <strong>BEFORE</strong> "{{ selectedLockStop.name || selectedLockStop.formatted_address }}". The optimizer will respect these constraints.
        </p>

        <div class="lock-options">
          <button
            v-for="stop in selection_state.selectedAddresses.filter(s => s.uid !== selectedLockStop.uid)"
            :key="stop.uid"
            class="lock-option-btn"
            :class="{
              selected: isPrerequisiteSelected(selectedLockStop.uid, stop.uid),
              disabled: !isPrerequisiteSelected(selectedLockStop.uid, stop.uid) && wouldCreateCycle(stop.uid, selectedLockStop.uid)
            }"
            :disabled="!isPrerequisiteSelected(selectedLockStop.uid, stop.uid) && wouldCreateCycle(stop.uid, selectedLockStop.uid)"
            @click="togglePrerequisite(selectedLockStop.uid, stop.uid)"
          >
            <div class="lock-checkbox">
              <span v-if="isPrerequisiteSelected(selectedLockStop.uid, stop.uid)">✓</span>
              <span v-else-if="wouldCreateCycle(stop.uid, selectedLockStop.uid)">✕</span>
            </div>
            <div class="lock-option-info">
              <div class="lock-option-name">{{ stop.name || stop.formatted_address }}</div>
              <div v-if="!isPrerequisiteSelected(selectedLockStop.uid, stop.uid) && wouldCreateCycle(stop.uid, selectedLockStop.uid)" class="cycle-warning">
                Would create circular dependency
              </div>
            </div>
          </button>
        </div>

        <button class="btn btn-primary" style="width: 100%; margin-top: 1rem;" @click="closeLockModal">Done</button>
      </div>
    </div>
  </div>
</template>