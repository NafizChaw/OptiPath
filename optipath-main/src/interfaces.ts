
export interface SelectionState {
    welcomeAcknowledged: Boolean,
    addressSelectionCompleted: Boolean,
    selectedAddresses: Array<any>,
    travelMode: String,
    routeOption: String,
    optimumRouteAddressOrder: Array<any>|'loading'|null,
}