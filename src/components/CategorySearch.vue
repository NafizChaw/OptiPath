<script setup lang="ts">
import { ref } from 'vue';

type LatLng = { lat: number; lng: number };
type PlaceLite = {
  id: string;
  name: string;
  formatted_address: string;
  rating?: number;
  user_ratings_total?: number;
  geometry?: { location: { lat(): number; lng(): number } };
  latLng?: { lat: number; lng: number };
};

const props = defineProps<{
  center?: LatLng | null;       // search bias
  radiusMeters?: number;        // default 5000
  placeholder?: string;         // input placeholder
  showLabel?: boolean;          // toggle the built-in label (default true)
}>();
const emit = defineEmits<{
  (e: 'select', place: PlaceLite): void
}>();

const query = ref('');
const loading = ref(false);
const results = ref<PlaceLite[]>([]);
const nextPageFn = ref<null | (() => void)>(null);
const error = ref<string | null>(null);

// Ensure PlacesService exists
let svc: google.maps.places.PlacesService | null = null;
function ensureService() {
  if (!svc) {
    svc = new google.maps.places.PlacesService(document.createElement('div'));
  }
}

// Map common words (extendable)
const TYPE_ALIASES: Record<string, string> = {
  'gas station': 'gas_station',
  'gas': 'gas_station',
  'grocery': 'grocery_or_supermarket',
  'grocery store': 'grocery_or_supermarket',
  'supermarket': 'grocery_or_supermarket',
  'pharmacy': 'pharmacy',
  'coffee': 'cafe',
  'cafe': 'cafe',
  'restaurant': 'restaurant',
  'bank': 'bank',
  'atm': 'atm',
  'parking': 'parking'
};

async function search() {
  results.value = [];
  nextPageFn.value = null;
  error.value = null;

  const qStr = query.value.trim();
  if (!qStr) return;

  if (!window.google?.maps?.places) {
    error.value = 'Places API not loaded.';
    return;
  }
  ensureService();

  loading.value = true;

  const q = qStr.toLowerCase();
  const type = TYPE_ALIASES[q] || undefined;
  const useNearby = !!(type && props.center);

  const handle = (
    res: google.maps.places.PlaceResult[] | null,
    status: google.maps.places.PlacesServiceStatus,
    pagination?: { hasNextPage: boolean; nextPage: () => void }
  ) => {
    loading.value = false;
    if (status !== google.maps.places.PlacesServiceStatus.OK || !res) {
      error.value = `Search failed: ${status}`;
      return;
    }
    results.value.push(
      ...res.map(r => ({
        id: r.place_id!,
        name: r.name || '(no name)',
        formatted_address: r.formatted_address || r.vicinity || '',
        rating: r.rating,
        user_ratings_total: r.user_ratings_total,
        geometry: r.geometry
      }))
    );
    nextPageFn.value = (pagination && pagination.hasNextPage) ? () => {
      loading.value = true;
      pagination.nextPage();
    } : null;
  };

  if (useNearby) {
    const req: google.maps.places.PlaceSearchRequest = {
      location: props.center!,
      radius: props.radiusMeters ?? 5000,
      type
    };
    svc!.nearbySearch(req, handle);
  } else {
    const req: google.maps.places.TextSearchRequest = {
      query: qStr,
      location: props.center ?? undefined,
      radius: props.radiusMeters ?? undefined
    };
    svc!.textSearch(req, handle);
  }
}

function add(place: PlaceLite) {
  const lat = place.geometry?.location?.lat();
  const lng = place.geometry?.location?.lng();
  emit('select', {
    ...place,
    ...(lat != null && lng != null ? { latLng: { lat, lng } } : {})
  });
}
</script>

<template>
  <div class="category-search">
    <!-- Show/hide label with prop -->
    <label v-if="showLabel !== false" class="form-label">Search by category</label>

    <div class="d-flex gap-2">
      <input
        class="form-control form-control-sm"
        :placeholder="placeholder || 'e.g., gas station, grocery store, pharmacy'"
        v-model="query"
        @keyup.enter="search"
      />
      <button class="btn btn-sm btn-outline-primary" @click="search" :disabled="loading">
        {{ loading ? 'Searching…' : 'Search' }}
      </button>
    </div>

    <div v-if="error" class="text-danger mt-2">{{ error }}</div>

    <div v-if="results.length" class="results mt-2">
      <div v-for="r in results" :key="r.id" class="result-row">
        <div class="info">
          <div class="title">{{ r.name }}</div>
          <div class="addr text-muted small">{{ r.formatted_address }}</div>

          <!-- TRUE partial stars (half-stars etc.) -->
          <div class="rating small" v-if="r.rating !== undefined">
            <span class="stars" :style="{ '--value': r.rating }"></span>
            <span class="ms-1">{{ r.rating.toFixed(1) }}</span>
            <span v-if="r.user_ratings_total"> ({{ r.user_ratings_total }})</span>
          </div>
        </div>

        <div class="actions">
          <button class="btn btn-sm btn-success" @click="add(r)">Add</button>
        </div>
      </div>

      <div class="text-center mt-2" v-if="nextPageFn">
        <button class="btn btn-sm btn-outline-secondary" @click="nextPageFn">More</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.results {
  max-height: 240px;          /* scrolling list */
  overflow: auto;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: .5rem;
  padding: .5rem;
}
.result-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: .25rem .75rem;
  align-items: center;
  padding: .45rem .25rem;
  border-bottom: 1px dashed rgba(255,255,255,.08);
}
.result-row:last-child { border-bottom: none; }
.title { font-weight: 600; }

/* ★★★★☆ with partial fill using CSS overlay */
.stars{
  --value: 0;              /* rating 0–5 */
  --size: 0.95rem;         /* adjustable for UI */
  position: relative;
  display: inline-block;
  font-size: var(--size);
  line-height: 1;
}
.stars::before{
  content: "★★★★★";        /* base (empty) */
  letter-spacing: 2px;
  color: rgba(255,255,255,0.28);
}
.stars::after{
  content: "★★★★★";        /* overlay (filled) */
  letter-spacing: 2px;
  color: #ffd166;           /* gold */
  position: absolute;
  inset: 0;
  width: calc((var(--value) / 5) * 100%);
  overflow: hidden;
  white-space: nowrap;
}
</style>
