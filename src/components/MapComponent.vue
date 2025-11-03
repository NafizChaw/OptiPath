<template>
  <div>
    <div ref="mapRef" style="width: 100%; height: 420px;"></div>

    <div
      class="route-summary-panel"
      v-if="totalDurationSec !== null && totalDistanceMeters !== null && totalTurns !== null"
    >
      <div><strong>Total time:</strong> {{ formatMinutes(totalDurationSec) }}</div>
      <div><strong>Total distance:</strong> {{ formatMiles(totalDistanceMeters) }}</div>
      <div><strong>Total turns:</strong> {{ formatTurns(totalTurns) }}</div>
    </div>

    <p v-if="props.strategy"
       class="text-muted small mt-2">
      Optimized for: {{ props.strategy }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";

const props = defineProps<{
  addresses: Array<any>,
  travelMode: string
  strategy?: string
}>();

const totalDurationSec = ref<number | null>(null);
const totalDistanceMeters = ref<number | null>(null);
const totalTurns = ref<number | null>(null);

const mapRef = ref<HTMLDivElement | null>(null);
let map: google.maps.Map | null = null;
let directionsService: google.maps.DirectionsService | null = null;
let directionsRenderer: google.maps.DirectionsRenderer | null = null;

function loadGoogleMapsScript(cb: () => void) {
  if (window.google?.maps) return cb();
  const s = document.createElement("script");
  s.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
  s.async = true;
  s.defer = true;
  s.onload = cb;
  document.head.appendChild(s);
}

function toGMode(mode: string): google.maps.TravelMode {
  switch (mode) {
    case "Walking":  return google.maps.TravelMode.WALKING;
    case "Bicycling":return google.maps.TravelMode.BICYCLING;
    default:         return google.maps.TravelMode.DRIVING;
  }
}

async function renderRoute() {
  if (!map || !directionsService || !directionsRenderer) return;
  if (!props.addresses || props.addresses.length < 2) return;

  const first = props.addresses[0];
  const origin: string | google.maps.LatLngLiteral =
    (first?.isCurrentLocation && first?.latLng)
      ? first.latLng
      : (first?.formatted_address || "");

  const destObj = props.addresses[props.addresses.length - 1];
  const destination: string | google.maps.LatLngLiteral =
    (destObj?.isCurrentLocation && destObj?.latLng)
      ? destObj.latLng
      : (destObj?.formatted_address || "");

  const waypoints = props.addresses.slice(1, -1).map(a => ({
    location: (a?.isCurrentLocation && a?.latLng) ? a.latLng : a.formatted_address,
    stopover: true
  }));

  directionsService.route(
    {
      origin,
      destination,
      waypoints,
      travelMode: toGMode(props.travelMode),
      optimizeWaypoints: false, // keep given order
    },
    (res, status) => {
      if (status === "OK" && res) {
        directionsRenderer.setDirections(res);
        const legs = res.routes?.[0]?.legs || [];

        // total time (seconds)
        let durationSum = 0;
        // total distance (meters)
        let distanceSum = 0;
        // total turns (sum of steps)
        let stepsSum = 0;

        for (const leg of legs) {
          if (leg.duration?.value != null) {
            durationSum += leg.duration.value;
          }
          if (leg.distance?.value != null) {
            distanceSum += leg.distance.value;
          }
          if (Array.isArray(leg.steps)) {
            stepsSum += leg.steps.length;
          }
        }
        totalDurationSec.value = durationSum;
        totalDistanceMeters.value = distanceSum;
        totalTurns.value = stepsSum;

        const bounds = new google.maps.LatLngBounds();
        res.routes[0].overview_path.forEach(p => bounds.extend(p));
        map!.fitBounds(bounds);
      } else {
        console.error("Directions failed:", status);
      }
    }
  );
}

function initMap() {
  map = new google.maps.Map(mapRef.value as HTMLElement, {
    zoom: 6,
    center: { lat: 27.994402, lng: -81.760254 },
  });
  directionsService = new google.maps.DirectionsService();
  directionsRenderer = new google.maps.DirectionsRenderer({ suppressMarkers: false });
  directionsRenderer.setMap(map);
  renderRoute();
}

function formatMinutes(sec: number | null): string {
  if (sec == null) return "—";
  const mins = Math.round(sec / 60);
  return `${mins} min`;
}

function formatMiles(meters: number | null): string {
  if (meters == null) return "—";
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

function formatTurns(turns: number | null): string {
  if (turns == null) return "—";
  return `${turns} turns`;
}

onMounted(() => loadGoogleMapsScript(initMap));
watch(() => [props.addresses, props.travelMode], renderRoute, { deep: true });
</script>

<style scoped>
.route-summary-panel {
  margin-top: 0.75rem;
  padding: 0.75rem 1rem;
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 0.5rem;
  background-color: rgba(0,0,0,0.4); /* looks good on dark mode UI */
  font-size: 0.9rem;
  line-height: 1.4;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 0.5rem 1rem;
}
.route-summary-panel strong {
  font-weight: 600;
}
</style>
