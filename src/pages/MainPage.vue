<script setup lang="ts">
import { ref } from "vue";
import {
  LOADING,
  MAX_SELECTABLE_ADDRESSES,
  MY_LOCATION,
  WELCOME_MESSAGE,
} from "../constants.ts";
import AddressComponent from "../components/AddressComponent.vue";
import { SelectionState } from "../interfaces.ts";
import MapComponent from "../components/MapComponent.vue";

// State
const selection_state = ref<SelectionState>({
  welcomeAcknowledged: false,
  addressSelectionCompleted: false,
  selectedAddresses: [],
  optimumRouteAddressOrder: null,
  travelMode: "Driving",
  routeOption: "Fastest",
});

const availableTransportationMethods = ["Driving", "Walking", "Bicycling"];

// Handlers
const handleAddressSelected = (newAddress: any, index: number) => {
  selection_state.value.selectedAddresses[index] = newAddress;
};

const removeSelectedAddress = (index: number) => {
  selection_state.value.selectedAddresses.splice(index, 1);
};

const getOptimumRoute = () => {
  // For now, just use entered addresses directly
  selection_state.value.optimumRouteAddressOrder =
    selection_state.value.selectedAddresses;
};

// Build Google Maps link
const getGoogleMapsRouteLink = (): string => {
  if (!selection_state.value.optimumRouteAddressOrder) return "";

  const googleMapsBaseUrl = "https://www.google.com/maps/dir/?api=1";

  const addresses = selection_state.value.optimumRouteAddressOrder as any[];

  const destinationPlace = addresses[addresses.length - 1];
  const destinationParameter = `&destination=${encodeURIComponent(
    destinationPlace.formatted_address
  )}`;

  const waypoints =
    Array.isArray(addresses)
      ? addresses
          .slice(1, -1)
          .map((a) => encodeURIComponent(a.formatted_address))
          .join("|")
      : "";

  const waypointsParameter = waypoints ? `&waypoints=${waypoints}` : "";

  const travelmodeParameter = `&travelmode=${selection_state.value.travelMode.toLowerCase()}`;

  return googleMapsBaseUrl + destinationParameter + waypointsParameter + travelmodeParameter;
};
</script>

<template>
  <div class="container mt-4">
    <div class="row justify-content-center">
      <div class="col-12 col-lg-8">

        <!-- Welcome -->
        <template v-if="!selection_state.welcomeAcknowledged">
          <h2>Welcome to OptiPath</h2>
          <p>{{ WELCOME_MESSAGE }}</p>
          <button
            class="btn btn-primary btn-sm mt-3"
            @click="selection_state.welcomeAcknowledged = true"
          >
            GET STARTED
          </button>
        </template>

        <!-- Address Input -->
        <template
          v-else-if="
            selection_state.welcomeAcknowledged &&
            !selection_state.addressSelectionCompleted
          "
        >
          <h2>Addresses</h2>
          <h4>
            Select at least 3 and up to {{ MAX_SELECTABLE_ADDRESSES }} addresses
          </h4>
          <h6>Note: Only current location is supported as origin at this time</h6>

          <ul>
            <li
              v-for="(address, index) in selection_state.selectedAddresses"
              :key="index"
            >
              Address {{ index + 1 }}: {{ address.formatted_address }}
              <button
                v-if="address && address.place_id != MY_LOCATION"
                class="btn btn-danger btn-sm m-1"
                @click="removeSelectedAddress(index)"
              >
                Remove
              </button>
            </li>
          </ul>
          <hr />

          <!-- Current location -->
          <button
            v-if="selection_state.selectedAddresses.length === 0"
            class="btn btn-primary btn-sm"
            @click="
              () =>
                (selection_state.selectedAddresses[0] = {
                  formatted_address: 'Current Location',
                  place_id: MY_LOCATION,
                })
            "
          >
            Add Current Location as Origin
          </button>

          <!-- Address input -->
          <div
            v-else-if="
              selection_state.selectedAddresses.length < MAX_SELECTABLE_ADDRESSES
            "
            class="col-12"
          >
            <label for="startingLocation" class="form-label"
              >Add an address:</label
            >
            <AddressComponent
              @addressSelected="
                handleAddressSelected($event, selection_state.selectedAddresses.length)
              "
            />
          </div>

          <!-- Next button -->
          <div class="col-12">
            <button
              :class="{
                disabled: selection_state.selectedAddresses.length < 3,
              }"
              class="btn btn-primary btn-sm mt-2"
              @click="selection_state.addressSelectionCompleted = true"
            >
              NEXT
            </button>
          </div>
        </template>

        <!-- Travel Options -->
        <template
          v-else-if="
            selection_state.addressSelectionCompleted &&
            !selection_state.optimumRouteAddressOrder
          "
        >
          <h2>Select Options</h2>
          <hr />
          <div class="mb-3">
            <label class="form-label">Select Mode of Transportation</label>
            <select
              @change="(e) => (selection_state.travelMode = e.target.value)"
              class="form-select"
            >
              <option hidden selected>{{ selection_state.travelMode }}</option>
              <option
                v-for="(method, idx) in availableTransportationMethods"
                :key="idx"
                :value="method"
              >
                {{ method }}
              </option>
            </select>
          </div>

          <button
            v-if="selection_state.travelMode"
            class="btn btn-primary btn-sm"
            @click="getOptimumRoute"
          >
            FIND ROUTE
          </button>
        </template>

        <!-- Map + Results -->
        <template v-else-if="selection_state.optimumRouteAddressOrder">
          <h2>Your Route</h2>
          <MapComponent
            :addresses="selection_state.optimumRouteAddressOrder"
            :travelMode="selection_state.travelMode"
          />
          <hr />
          <a
            target="_blank"
            :href="getGoogleMapsRouteLink()"
            class="btn btn-primary"
            >Open in Google Maps</a
          >
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hover-primary:hover {
  border-color: var(--bs-primary) !important;
}
.cursor-pointer:hover {
  cursor: pointer;
}
.card.active {
  border-color: var(--bs-secondary);
  border-width: 3px;
}
</style>
