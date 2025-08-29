<script setup lang="ts">
import { ref } from 'vue';
import {LOADING, MAX_SELECTABLE_ADDRESSES, MY_LOCATION, WELCOME_MESSAGE} from "../constants.ts";
import AddressComponent from "../components/AddressComponent.vue";
import {SelectionState} from "../interfaces.ts"; // Correct the path to your component


const selection_state = ref<SelectionState>({
  welcomeAcknowledged: false,
  addressSelectionCompleted: false,
  selectedAddresses: [],
  optimumRouteAddressOrder: null,
  travelMode: 'Driving',
  routeOption: 'Fastest',
});

const availableTransportationMethods = ['Driving', 'Walking', 'Bicycling'];

const handleAddressSelected = (newAddress: object, index: number) => {
  selection_state.value.selectedAddresses[index] = newAddress;
};

const removeSelectedAddress = (index: number) => {
  selection_state.value.selectedAddresses.splice(index, 1); 
};

const getOptimumRoute = () => {
  selection_state.value.optimumRouteAddressOrder = LOADING;
}

const getGoogleMapsRouteLink = ():string =>{
  if(!selection_state.value.optimumRouteAddressOrder)
    return "";

  const googleMapsBaseUrl = "https://www.google.com/maps/dir/?api=1";

  const optimumAddressCount = selection_state.value.optimumRouteAddressOrder.length;
  const destinationPlace = selection_state.value.optimumRouteAddressOrder[optimumAddressCount-1];
  const destinationParameter = `&destination_place_id=${destinationPlace.place_id}&destination=${destinationPlace.formatted_address}`;


  const waypointPlaces = selection_state.value.optimumRouteAddressOrder.filter((_, index) => index > 0 && index < optimumAddressCount - 1);
  const waypointsParameter = "&waypoints="+waypointPlaces.map(address => address.formatted_address).join("|");
  const waypointPlaceIdsParameter = "&waypoint_place_ids="+waypointPlaces.map(address => address.place_id).join("|");

  const travelmodeParameter = `&travelmode=${selection_state.value.travelMode.toLowerCase()}`;

  return encodeURI(googleMapsBaseUrl+destinationParameter+waypointPlaceIdsParameter+waypointsParameter+travelmodeParameter);
}

</script>


<template>
  <div class="container mt-4">
    <div class="row justify-content-center">
      <div class="col-12 col-lg-8">
        <!--Welcome-->
        <template v-if="!selection_state.welcomeAcknowledged">
          <h2>Welcome to Optipath</h2>
          <div>{{ WELCOME_MESSAGE }}</div>
          <button class="btn btn-primary btn-sm mt-3" @click="()=>selection_state.welcomeAcknowledged=true">GET
            STARTED
          </button>
        </template>
        <!--End Welcome-->

        <!--    Addresses-->
        <template v-if="selection_state.welcomeAcknowledged && !selection_state.addressSelectionCompleted">
          <h2>Addresses</h2>
          <h4>Select atleast 3 and upto {{ MAX_SELECTABLE_ADDRESSES }} addresses</h4>
          <h6>Note: Only current location is supported as origin at this time</h6>
            <ul>
              <li v-for="(address, index) in selection_state.selectedAddresses" :key="index">Address {{ index + 1 }}:
                {{ address.formatted_address }}
                <button v-if="address && address.place_id != MY_LOCATION" class="btn btn-danger btn-sm m-1" type="button" :id="'address'+(index+1)"
                        @click="removeSelectedAddress(index)">Remove
                </button>
              </li>
            </ul>
          <hr/>

          <button v-if="selection_state.selectedAddresses.length === 0" class="btn btn-primary btn-sm" @click="()=>{selection_state.selectedAddresses[0]={formatted_address: 'Current Location', place_id:MY_LOCATION}}"
          >Add Current Location as Origin</button>

          <div v-else-if="selection_state.selectedAddresses.length < MAX_SELECTABLE_ADDRESSES" class="col-12">
            <label for="startingLocation" class="form-label">Add an address:</label>
            <AddressComponent
                @addressSelected="handleAddressSelected($event, selection_state.selectedAddresses.length)"/>
          </div>

          <div class="col-12">
            <button :class="{disabled: selection_state.selectedAddresses.length < 3}" class="btn btn-primary btn-sm mt-2" @click="()=>selection_state.addressSelectionCompleted = true">
              NEXT
            </button>
          </div>
        </template>
        <!--    End Addresses-->

        <!--    Options -->
        <template v-if="selection_state.addressSelectionCompleted && !selection_state.optimumRouteAddressOrder">
          <h2>Select Options</h2>
          <hr/>
          <div class="mb-3">
            <label class="form-label">Select Mode of Transportation</label>
            <select @change="(e)=>selection_state.travelMode = e.target.value" class="form-select"
                    aria-label="Default select example">
              <option hidden selected>{{ selection_state.travelMode }}</option>
              <option v-for="(method) in availableTransportationMethods" :value="method">{{ method }}</option>
            </select>
          </div>

<!--          <div class="mb-3">-->
<!--            <label class="form-label">Route Option</label>-->
<!--            <select @change="(e)=>selection_state.routeOption = e.target.value" class="form-select"-->
<!--                    aria-label="Default select example">-->
<!--              <option hidden selected>{{ selection_state.routeOption }}</option>-->
<!--              <option v-for="(method) in availableOptimizationOptions" :value="method">{{ method }}</option>-->
<!--            </select>-->
<!--          </div>-->

<!--          <div class="mb-3">
            <div class="form-check">
              <input class="form-check-input" type="checkbox" value="" id="flexCheckDefault">
              <label class="form-check-label" for="flexCheckDefault">
                Avoid Tolls?
              </label>
            </div>
          </div>-->

          <button v-if="selection_state.travelMode" class="btn btn-primary btn-sm" @click="getOptimumRoute">
            FIND OPTIMUM ROUTE
          </button>

        </template>
        <!--End Options -->
        <div class="text-center" v-if="selection_state.optimumRouteAddressOrder === LOADING">
          <img src="../assets/images/loading.gif" width="200">
          <div>Calculating Optimum Path</div>
        </div>
        <!--        Optimum Route Result-->
        <template v-else-if="selection_state.optimumRouteAddressOrder">
          <h2>Optimum Route Order</h2>
          <h5>Using routing info from Google Maps, Optipath suggests, the following order will complete your trip fastest. Happy Journey!</h5>
          <hr/>
          <ul>
            <li v-for="(address, index) in selection_state.optimumRouteAddressOrder" :key="index">Address {{ index + 1 }}:
              {{ address.formatted_address }}
            </li>
          </ul>
          <a target="_blank" :href="getGoogleMapsRouteLink()" class="btn btn-primary">Open Google Maps</a>
          <hr/>
<!--          <div>Link: {{getGoogleMapsRouteLink()}}</div>-->
        </template>

      </div>
    </div>
  </div>
</template>


<style scoped>
/* Add any additional custom styles if needed */

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
