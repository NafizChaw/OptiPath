<template>
  <div>
    <div ref="mapRef" style="width: 100%; height: 420px;"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";

const props = defineProps<{
  addresses: Array<any>,
  travelMode: string
}>();

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

onMounted(() => loadGoogleMapsScript(initMap));
watch(() => [props.addresses, props.travelMode], renderRoute, { deep: true });
</script>
