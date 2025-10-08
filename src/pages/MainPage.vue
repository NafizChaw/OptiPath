<script setup lang="ts">
import { ref, computed } from "vue";
import {
  MAX_SELECTABLE_ADDRESSES,
  WELCOME_MESSAGE,
  LOADING,
} from "../constants";
import AddressComponent from "../components/AddressComponent.vue";
import MapComponent from "../components/MapComponent.vue";
import type { SelectionState } from "../interfaces";
import { computeBestRoute, suggestBestDeparture } from "../algo/computeBestRoute";
import Draggable from "vuedraggable";
import LLMChat from "../components/LLMChat.vue"; // ✅ AI Chat

// ---------- state ----------
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

const availableTransportationMethods = ["Driving", "Walking", "Bicycling"];
const canProceed = computed(
  () => selection_state.value.selectedAddresses.length >= 2
);

const prereqsByUid = ref<Record<string, string[]>>({}); // afterUid -> [beforeUid,...]
const finishUid = ref<string | null>(null);
const editingIndex = ref<number | null>(null);

function startEdit(i: number) { editingIndex.value = i; }
function cancelEdit() { editingIndex.value = null; }
function saveEditedAddress(newAddress: any, index: number) {
  selection_state.value.selectedAddresses[index] = withUid(newAddress);
  selection_state.value.optimumRouteAddressOrder = null;
  editingIndex.value = null;
}

// ---------- helpers ----------
function withUid<T extends Record<string, any>>(obj: T): T & { uid: string } {
  if ((obj as any)?.uid) return obj as any;
  const uid =
    (globalThis.crypto as any)?.randomUUID?.() ||
    String(Date.now() + Math.random());
  return { ...obj, uid };
}

// ✅ Gemini chat payload handler
function addFromLLM(payload: {
  origin: any, stops: any[], finish?: any, constraints?: Array<[number, number]>
}) {
  const withUidWrap = (o: any) => withUid(o);

  // Origin
  const idxCur = selection_state.value.selectedAddresses.findIndex(a => a?.isCurrentLocation);
  if (payload.origin?.isCurrentLocation) {
    if (idxCur === -1) {
      selection_state.value.selectedAddresses.unshift(withUidWrap(payload.origin));
      selection_state.value.startIndex = 0;
    } else {
      const existing = selection_state.value.selectedAddresses[idxCur];
      selection_state.value.selectedAddresses[idxCur] = {
        ...payload.origin,
        uid: existing?.uid ?? withUidWrap(payload.origin).uid
      };
      selection_state.value.startIndex = idxCur;
    }
  } else if (payload.origin) {
    selection_state.value.selectedAddresses.unshift(withUidWrap(payload.origin));
    selection_state.value.startIndex = 0;
  }

  // Stops
  const baseIndex = selection_state.value.selectedAddresses.length;
  for (const s of payload.stops) selection_state.value.selectedAddresses.push(withUidWrap(s));

  // Finish (pin it)
  if (payload.finish) {
    const f = withUidWrap(payload.finish);
    selection_state.value.selectedAddresses.push(f);
    finishUid.value = f.uid;
  }

  // Constraints → prereqsByUid
  if (payload.constraints?.length) {
    const added = selection_state.value.selectedAddresses.slice(baseIndex);
    const toUid = (localIdx: number) => added[localIdx]?.uid;
    for (const [beforeLocal, afterLocal] of payload.constraints) {
      const bUid = toUid(beforeLocal), aUid = toUid(afterLocal);
      if (!bUid || !aUid) continue;
      for (const k of Object.keys(prereqsByUid.value)) {
        prereqsByUid.value[k] = (prereqsByUid.value[k] || []).filter(u => u !== bUid);
        if (!prereqsByUid.value[k].length) delete prereqsByUid.value[k];
      }
      const arr = prereqsByUid.value[aUid] || [];
      if (!arr.includes(bUid)) arr.push(bUid);
      prereqsByUid.value[aUid] = arr;
    }
  }

  selection_state.value.optimumRouteAddressOrder = null;
  selection_state.value.addressSelectionCompleted = true;
  // await optimizeRoute(); // uncomment for immediate optimization
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
      prereqsByUid.value[k] = (prereqsByUid.value[k] || []).filter(
        (u) => u !== removed.uid
      );
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
      navigator.geolocation.getCurrentPosition(
        resolve, reject,
        { enableHighAccuracy: true, timeout: 10000 }
      );
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
      selection_state.value.selectedAddresses[idx] = {
        ...myLoc,
        uid: existing?.uid ?? myLoc.uid,
      };
      selection_state.value.startIndex = idx;
    }

    selection_state.value.useCurrentLocation = true;
  } catch {
    alert("Could not get current location. Please allow location access.");
  }
}

// ---------- start-mode handlers ----------
function chooseCurrent() {
  selection_state.value.startModeChosen = true;
  selection_state.value.useCurrentLocation = true;
  useCurrentLocationAsOrigin();
}
function chooseDifferent() {
  selection_state.value.startModeChosen = true;
  selection_state.value.useCurrentLocation = false;
}

// ---------- preview / optimization ----------
function rotateToStartIndex<T>(arr: T[], startIndex: number): T[] {
  if (!arr?.length) return [];
  const i = Math.max(0, Math.min(startIndex ?? 0, arr.length - 1));
  return [...arr.slice(i), ...arr.slice(0, i)];
}

const bestDepartureHint = ref<string | null>(null);

const previewRoute = () => {
  const rotated = rotateToStartIndex(
    selection_state.value.selectedAddresses,
    selection_state.value.startIndex ?? 0
  );
  selection_state.value.optimumRouteAddressOrder = rotated as any;
  selection_state.value.addressSelectionCompleted = true;
};

function toGMode(mode: string): google.maps.TravelMode {
  switch (mode) {
    case "Walking":   return google.maps.TravelMode.WALKING;
    case "Bicycling": return google.maps.TravelMode.BICYCLING;
    default:          return google.maps.TravelMode.DRIVING;
  }
}

function normalizeForMatrix(a: any): string | google.maps.LatLngLiteral {
  return a?.isCurrentLocation && a?.latLng
    ? a.latLng
    : a.formatted_address || a.name;
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

  const endIndex =
    finishUid.value && finishUid.value in idOf
      ? idOf[finishUid.value]
      : undefined;

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

const optimizeRoute = async () => {
  const stops = selection_state.value.selectedAddresses;
  if (!stops || stops.length < 2) return;

  bestDepartureHint.value = null;
  selection_state.value.optimumRouteAddressOrder = LOADING as any;

  try {
    await ensureGoogleLoaded();

    const addresses = stops.map(normalizeForMatrix);
    const mode = toGMode(selection_state.value.travelMode);

    const { prerequisites, endIndex } = buildConstraintIndexes(stops);

    const { order } = await computeBestRoute(addresses as any, mode, {
      startIndex: selection_state.value.startIndex ?? 0,
      returnToStart: false,
      departureTime: new Date(),
      prerequisites,
      endIndex,
    });

    selection_state.value.optimumRouteAddressOrder = order.map((i) => stops[i]);

    // small departure sweep
    try {
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
      bestDepartureHint.value = null;
    }
  } catch (e) {
    console.error(e);
    alert("Optimization failed. Check Google Maps JS & Distance Matrix (with billing) and disable ad blockers for this site.");
    selection_state.value.optimumRouteAddressOrder = null;
  }
};

// ---------- external links ----------
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
      const encoded =
        a?.isCurrentLocation && a?.latLng
          ? `${a.latLng.lat},${a.latLng.lng}`
          : encodeURIComponent(a.formatted_address);
      return idx === 0 ? encoded : `to:${encoded}`;
    })
    .join(" ");

  const dirflg = appleDirFlag(mode);
  return `${base}?saddr=${saddr}&daddr=${dests}&dirflg=${dirflg}`;
}

// ---------- UI helpers for constraints ----------
function toggleFinish(uid: string) {
  finishUid.value = finishUid.value === uid ? null : uid;
  selection_state.value.optimumRouteAddressOrder = null;
}
function currentAfterFor(beforeUid: string): string {
  for (const [after, befores] of Object.entries(prereqsByUid.value)) {
    if ((befores || []).includes(beforeUid)) return after;
  }
  return "";
}
function setMustComeBefore(beforeUid: string, afterUid: string) {
  for (const k of Object.keys(prereqsByUid.value)) {
    prereqsByUid.value[k] = (prereqsByUid.value[k] || []).filter(
      (u) => u !== beforeUid
    );
    if (!prereqsByUid.value[k].length) delete prereqsByUid.value[k];
  }
  if (afterUid) {
    const arr = prereqsByUid.value[afterUid] || [];
    if (!arr.includes(beforeUid)) arr.push(beforeUid);
    prereqsByUid.value[afterUid] = arr;
  }
  selection_state.value.optimumRouteAddressOrder = null;
}
</script>

<template>
  <div class="container mt-4">
    <div class="row justify-content-center">
      <div class="col-12 col-lg-8">
        <template v-if="!selection_state.welcomeAcknowledged">
          <h2>Welcome to OptiPath</h2>
          <p>{{ WELCOME_MESSAGE }}</p>
          <button class="btn btn-primary btn-sm mt-3" @click="selection_state.welcomeAcknowledged = true">
            GET STARTED
          </button>
        </template>

        <template v-else-if="!selection_state.startModeChosen">
          <h2>Choose Start Location</h2>
          <hr />
          <p>Select how you’d like to set your starting point.</p>
          <div class="d-flex gap-3 mt-3 flex-wrap">
            <button class="btn btn-primary btn-sm" @click="chooseCurrent">Use Current Location</button>
            <button class="btn btn-secondary btn-sm" @click="chooseDifferent">Use Different Location</button>
          </div>
        </template>

        <!-- 📍 Addresses step -->
        <template v-else-if="!selection_state.addressSelectionCompleted">
          <h2>Addresses</h2>
          <h5>Select at least 2 and up to {{ MAX_SELECTABLE_ADDRESSES }} addresses</h5>

          <!-- 🧠 AI Chat (Gemini) -->
          <LLMChat @resolvedStops="addFromLLM" />

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
              <li class="d-flex align-items-center gap-2 py-1 flex-wrap">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>

                <div class="d-flex flex-column me-2">
                  <strong class="stop-name">
                    {{ element.name || element.formatted_address }}
                  </strong>
                </div>

                <button
                  class="btn btn-outline-secondary btn-sm"
                  :class="{ 'btn-success': finishUid === element.uid }"
                  @click="toggleFinish(element.uid)"
                  title="Set this stop as fixed finish"
                >
                  {{ finishUid === element.uid ? "Pinned Finish" : "Set as Finish" }}
                </button>

                <div class="d-flex align-items-center gap-1">
                  <small>Must come before:</small>
                  <select
                    class="form-select form-select-sm"
                    :value="currentAfterFor(element.uid)"
                    @change="(e:any)=>setMustComeBefore(element.uid, e.target.value)"
                  >
                    <option value="">No priority</option>
                    <option
                      v-for="other in selection_state.selectedAddresses.filter(s => s.uid !== element.uid)"
                      :key="other.uid"
                      :value="other.uid"
                    >
                      {{ other.name || other.formatted_address }}
                    </option>
                  </select>
                </div>

                <div class="ms-auto d-flex gap-2">
                  <button class="btn btn-outline-primary btn-sm" @click="startEdit(index)">Edit</button>
                  <button
                    v-if="!element?.isCurrentLocation"
                    class="btn btn-danger btn-sm"
                    @click="removeSelectedAddress(index)"
                  >
                    Remove
                  </button>
                </div>

                <div v-if="editingIndex === index" class="w-100 mt-2">
                  <AddressComponent @addressSelected="(addr:any) => saveEditedAddress(addr, index)" />
                  <div class="mt-2">
                    <button class="btn btn-secondary btn-sm" @click="cancelEdit">Cancel</button>
                  </div>
                </div>
              </li>
            </template>
          </Draggable>

          <hr />

          <div
            v-if="selection_state.selectedAddresses.length < MAX_SELECTABLE_ADDRESSES"
            class="mt-3"
          >
            <label class="form-label">Add an address</label>
            <AddressComponent
              @addressSelected="handleAddressSelected($event, selection_state.selectedAddresses.length)"
            />
          </div>

          <div class="d-flex gap-2 mt-3 flex-wrap">
            <button class="btn btn-secondary btn-sm" @click="previewRoute" :disabled="!canProceed">
              Preview route
            </button>
            <button
              class="btn btn-primary btn-sm"
              @click="selection_state.addressSelectionCompleted = true"
              :disabled="!canProceed"
            >
              Next
            </button>
          </div>
        </template>

        <!-- 🗺️ Route / Optimize -->
        <template v-else>
          <h2>Route</h2>

          <div class="mb-3">
            <label class="form-label">Mode</label>
            <select
              class="form-select"
              :value="selection_state.travelMode"
              @change="(e:any)=>selection_state.travelMode = e.target.value"
            >
              <option v-for="m in availableTransportationMethods" :key="m" :value="m">
                {{ m }}
              </option>
            </select>
          </div>

          <MapComponent
            :addresses="
              selection_state.optimumRouteAddressOrder &&
              selection_state.optimumRouteAddressOrder !== 'loading'
                ? (selection_state.optimumRouteAddressOrder as any[])
                : selection_state.selectedAddresses
            "
            :travelMode="selection_state.travelMode"
          />

          <div class="text-center mt-3" v-if="selection_state.optimumRouteAddressOrder === LOADING">
            Calculating optimum route…
          </div>

          <p v-if="bestDepartureHint" class="mt-2 text-muted">
            {{ bestDepartureHint }}
          </p>

          <div class="d-flex flex-wrap gap-2 mt-3">
            <button class="btn btn-outline-secondary btn-sm" @click="selection_state.addressSelectionCompleted = false">
              Back to edit
            </button>

            <button class="btn btn-primary btn-sm" @click="optimizeRoute">
              Optimize order
            </button>

            <a
              class="btn btn-success btn-sm"
              :href="
                googleMapsLink(
                  selection_state.optimumRouteAddressOrder &&
                  selection_state.optimumRouteAddressOrder !== 'loading'
                    ? (selection_state.optimumRouteAddressOrder as any[])
                    : selection_state.selectedAddresses,
                  selection_state.travelMode
                )
              "
              target="_blank"
              >Open in Google Maps</a
            >

            <a
              class="btn btn-dark btn-sm"
              :href="
                appleMapsLink(
                  selection_state.optimumRouteAddressOrder &&
                  selection_state.optimumRouteAddressOrder !== 'loading'
                    ? (selection_state.optimumRouteAddressOrder as any[])
                    : selection_state.selectedAddresses,
                  selection_state.travelMode
                )
              "
              target="_blank"
              >Open in Apple Maps</a
            >
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
.stop-name { color: var(--text); font-weight: 600; }
.stop-address { font-size: 0.85em; color: var(--text); opacity: 0.7; }
</style>
