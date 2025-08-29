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
import { ref, onMounted, nextTick } from 'vue';

// Emit event for adding address
const emit = defineEmits(['addressSelected']);

// Input ref
const addressInput = ref<HTMLInputElement | null>(null);

// Let Vue know which autocomplete instance we're dealing with
let autocomplete: google.maps.places.Autocomplete | null = null;

// Initialize autocomplete with Google Places API
const initAutocomplete = () => {
  nextTick(() => {
    if (addressInput.value && google?.maps?.places) {
      autocomplete = new google.maps.places.Autocomplete(addressInput.value);

      // Listen for when the user selects a place from the autocomplete dropdown
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete?.getPlace();
        // const formattedAddress = place?.formatted_address || addressInput.value?.value;
        emit('addressSelected', place); // Emit the selected address to the parent
        if(addressInput.value){
          addressInput.value.value = '';
        }
      });
    } else {
      console.error("Google Maps API not loaded or input element not found.");
    }
  });
}

// Load Google Maps API dynamically
const loadGoogleMapsScript = (callback: () => void) => {
  if (!window.google || !google.maps) {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=AIzaSyAmgivAhY3JKKs6M-7vfXd2CzqaLSUxwtk&libraries=places`; // Replace YOUR_API_KEY with the actual key
    script.async = true;
    script.defer = true;
    script.onload = () => {
      console.log("Google Maps script loaded");
      callback();
    };
    document.head.appendChild(script);
  } else {
    callback(); // If script is already loaded, proceed
  }
};

// Initialize Google Maps and autocomplete on component mount
onMounted(() => {
  loadGoogleMapsScript(() => {
    initAutocomplete(); // Initialize autocomplete for the input
  });
});
</script>
