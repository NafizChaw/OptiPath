<template>
  <div>
    <div ref="mapRef" style="width: 100%; height: 400px;"></div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
/// <reference types="google.maps" />

const props = defineProps<{
  addresses: Array<any>,
  travelMode: string
}>();

const mapRef = ref<HTMLDivElement | null>(null);
let map: any;
let directionsService: any;
let directionsRenderer: any;

const loadGoogleMapsScript = (callback: () => void) => {
  if (!window.google || !(window.google as any).maps) {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${
      import.meta.env.VITE_GOOGLE_MAPS_API_KEY
    }&libraries=places`;
    script.async = true;
    script.defer = true;
    script.onload = callback;
    document.head.appendChild(script);
  } else {
    callback();
  }
};

const renderRoute = () => {
  if (!props.addresses || props.addresses.length < 2) return;

  const origin = props.addresses[0];
  const destination = props.addresses[props.addresses.length - 1];
  const waypoints = props.addresses
    .slice(1, -1)
    .map((a) => ({ location: a.formatted_address, stopover: true }));

  directionsService.route(
    {
      origin: origin.formatted_address,
      destination: destination.formatted_address,
      waypoints: waypoints,
      travelMode: props.travelMode.toUpperCase() as google.maps.TravelMode,
    },
    (result, status) => {
      if (status === "OK" && result) {
        directionsRenderer.setDirections(result);
      } else {
        console.error("Directions request failed:", status);
      }
    }
  );
};

onMounted(() => {
  loadGoogleMapsScript(() => {
    map = new google.maps.Map(mapRef.value as HTMLElement, {
      zoom: 7,
      center: { lat: 27.994402, lng: -81.760254 }, // Florida center (adjust as needed)
    });
    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer();
    directionsRenderer.setMap(map);
    renderRoute();
  });
});

// re-render when addresses or travelMode changes
watch(() => [props.addresses, props.travelMode], renderRoute, { deep: true });
</script>
