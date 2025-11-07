<template>
  <div class="map-root">
    <div ref="mapRef" class="map-el"></div>
    <div v-if="loading" class="map-loading">
      <div class="spinner"></div>
      <p>Loading map...</p>
    </div>
    <div v-if="error" class="map-error">
      <p>{{ error }}</p>
      <button @click="retryInit" class="retry-btn">Retry</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onBeforeUnmount } from "vue";

const props = defineProps<{ addresses: any[]; travelMode: string }>();

const totalDurationSec = ref<number | null>(null);
const totalDistanceMeters = ref<number | null>(null);
const totalTurns = ref<number | null>(null);

const mapRef = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

let map: google.maps.Map | null = null;
let directionsService: google.maps.DirectionsService | null = null;
let directionsRenderer: google.maps.DirectionsRenderer | null = null;
let isInitialized = ref(false);

function loadGoogleMaps(): Promise<void> {
  const w = window as any;

  if (w.google?.maps?.Map && w.google?.maps?.DirectionsService) {
    return Promise.resolve();
  }

  if (w.__gmapsLoaderPromise) {
    return w.__gmapsLoaderPromise;
  }

  w.__gmapsLoaderPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("gmaps-js") as HTMLScriptElement | null;

    if (existing && w.google?.maps?.Map) {
      resolve();
      return;
    }

    if (existing && !w.google?.maps) {
      existing.addEventListener("load", () => {
        setTimeout(() => resolve(), 100);
      }, { once: true });
      existing.addEventListener("error", () => reject(new Error("Google Maps load error")), { once: true });
      return;
    }

    const s = document.createElement("script");
    s.id = "gmaps-js";
    s.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&v=weekly`;
    s.async = true;
    s.defer = true;
    s.addEventListener("load", () => {
      setTimeout(() => resolve(), 100);
    }, { once: true });
    s.addEventListener("error", () => reject(new Error("Google Maps load error")), { once: true });
    document.head.appendChild(s);
  });

  return w.__gmapsLoaderPromise;
}

function toGMode(mode: string): google.maps.TravelMode {
  switch (mode) {
    case "Walking": return google.maps.TravelMode.WALKING;
    case "Bicycling": return google.maps.TravelMode.BICYCLING;
    default: return google.maps.TravelMode.DRIVING;
  }
}

function renderRoute() {
  if (!map || !directionsService || !directionsRenderer || !isInitialized.value) {
    return;
  }

  if (!props.addresses || props.addresses.length < 2) {
    map.setCenter({ lat: 27.994402, lng: -81.760254 });
    map.setZoom(6);
    directionsRenderer.setDirections({ routes: [] } as any);
    return;
  }

  const first = props.addresses[0];
  const last = props.addresses[props.addresses.length - 1];

  const origin: string | google.maps.LatLngLiteral =
    first?.latLng || first?.formatted_address || first?.name;
  const destination: string | google.maps.LatLngLiteral =
    last?.latLng || last?.formatted_address || last?.name;

  const waypoints = props.addresses.slice(1, -1).map(a => ({
    location: a.latLng || a.formatted_address || a.name,
    stopover: true,
  }));

  directionsService.route(
    {
      origin,
      destination,
      waypoints,
      travelMode: toGMode(props.travelMode),
      optimizeWaypoints: false,
    },
    (res, status) => {
      if (status === "OK" && res) {
        directionsRenderer!.setDirections(res);
        const bounds = new google.maps.LatLngBounds();
        res.routes[0].overview_path.forEach(p => bounds.extend(p));
        map!.fitBounds(bounds);
      } else {
        console.warn("Directions failed:", status);
      }
    }
  );
}

async function initMap() {
  try {
    loading.value = true;
    error.value = null;

    await loadGoogleMaps();
    await nextTick();

    const checkReady = () =>
      new Promise<void>((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 50;
        const wait = () => {
          const w = window as any;
          if (w.google?.maps?.Map && w.google?.maps?.DirectionsService) {
            resolve();
          } else if (attempts++ < maxAttempts) {
            setTimeout(wait, 100);
          } else {
            reject(new Error("Google Maps failed to initialize"));
          }
        };
        wait();
      });
    
    await checkReady();

    if (!mapRef.value) {
      throw new Error("Map element not found");
    }

    map = new google.maps.Map(mapRef.value, {
      center: { lat: 27.994402, lng: -81.760254 },
      zoom: 6,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({ 
      suppressMarkers: false,
      draggable: false 
    });
    directionsRenderer.setMap(map);

    await new Promise<void>((resolve) => {
      google.maps.event.addListenerOnce(map!, "idle", () => {
        isInitialized.value = true;
        resolve();
      });
    });

    renderRoute();
    loading.value = false;
  } catch (e) {
    console.error("Map init failed:", e);
    error.value = e instanceof Error ? e.message : "Failed to load map";
    loading.value = false;
  }
}

async function retryInit() {
  if (directionsRenderer) directionsRenderer.setMap(null);
  directionsRenderer = null;
  directionsService = null;
  map = null;
  isInitialized.value = false;
  
  await initMap();
}

onMounted(async () => {
  await initMap();
});

watch(
  () => [props.addresses, props.travelMode],
  () => {
    if (isInitialized.value && map) {
      renderRoute();
    }
  },
  { deep: true }
);

onBeforeUnmount(() => {
  if (directionsRenderer) directionsRenderer.setMap(null);
  directionsRenderer = null;
  directionsService = null;
  map = null;
  isInitialized.value = false;
});
</script>

<style scoped>
.map-root { 
  position: fixed; 
  inset: 0; 
  z-index: 0; 
}

.map-el { 
  width: 100%; 
  height: 100vh; 
  background: #e5e5e5; 
}

.map-loading,
.map-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.95);
  z-index: 10;
}

.spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--accent, #22c55e);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.map-loading p,
.map-error p {
  margin-top: 1rem;
  color: var(--text, #1a1a1a);
  font-weight: 500;
}

.retry-btn {
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 8px;
  background: var(--accent, #22c55e);
  color: white;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.retry-btn:hover {
  transform: translateY(-1px);
}
</style>
