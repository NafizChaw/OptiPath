<template>
  <input
      :id="'autocomplete-' + index"
      type="text"
      class="form-control"
      placeholder="Search for a place"
      ref="addressInput" :aria-describedby="'address'+index"
  />
</template>

<script setup lang="ts">
declare const google: any;

declare global {
  interface Window {
    google: any;
  }
}

import { ref, nextTick, onMounted } from 'vue';

const emit = defineEmits(['addressSelected']);

const addressInput = ref<HTMLInputElement | null>(null);

let autocomplete: any = null;

const initAutocomplete = () => {
  nextTick(() => {
    if (addressInput.value && google?.maps?.places) {
      autocomplete = new google.maps.places.Autocomplete(addressInput.value);

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete?.getPlace();
        emit('addressSelected', place); 
        if(addressInput.value){
          addressInput.value.value = '';
        }
      });
    } else {
      console.error("Google Maps API not loaded or input element not found.");
    }
  });
}

const loadGoogleMapsScript = (callback: () => void) => {
if (!window.google || !(window.google as any).maps) {
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places`;
  script.async = true;
  script.defer = true;
  script.onload = () => {
    console.log("Google Maps script loaded");
    callback();
  };
  document.head.appendChild(script);
} else {
  callback(); 
}
};

onMounted(() => {
  loadGoogleMapsScript(() => {
    initAutocomplete(); 
  });
});
</script>
