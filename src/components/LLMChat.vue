<template>
  <div class="card p-3 mt-3">
    <h5 class="mb-2">AI Chat (Gemini)</h5>
    <div class="mb-2 small text-muted">
      Try: <em>“from my home go to Walmart then Target, pick up cat litter at a pet store, end at 123 Main St”</em>
    </div>

    <textarea v-model="input" class="form-control" rows="3"
      placeholder="Tell me your route in plain English…"></textarea>

    <div class="d-flex gap-2 mt-2">
      <button class="btn btn-primary btn-sm" :disabled="loading" @click="submit">
        {{ loading ? 'Thinking…' : 'Parse & Add Stops' }}
      </button>
      <button class="btn btn-outline-secondary btn-sm" @click="setHome">Set ‘Home’</button>
    </div>

    <div v-if="debugPlan" class="mt-3">
      <div class="small text-muted">LLM plan (JSON):</div>
      <pre class="bg-body-tertiary p-2 small" style="max-height:200px;overflow:auto;">{{ debugPlan }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { resolveChatPlan, ensureGoogleLoaded } from "../api/placesResolve";

const emit = defineEmits<{
  (e: "resolvedStops", payload: {
    origin: any,
    stops: any[],
    finish?: any,
    constraints?: Array<[number, number]>
  }): void
}>();

const input = ref("");
const loading = ref(false);
const debugPlan = ref<string | null>(null);

function setHome() {
  const cur = localStorage.getItem("optipath_home_addr") || "";
  const next = prompt("Enter your Home address (or coordinates):", cur);
  if (next) localStorage.setItem("optipath_home_addr", next);
  alert("Home saved.");
}

async function submit() {
  if (!input.value.trim()) return;
  loading.value = true;
  debugPlan.value = null;

  try {
    await ensureGoogleLoaded();

    // 1) Parse itinerary with Gemini (our backend)
    const res = await fetch("/chat/parse-itinerary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: input.value })
    });
    const data = await res.json();
    if (!data?.ok) throw new Error(data?.error || "LLM parse failed");

    const plan = data.plan as {
      origin_hint: "current location" | "home" | "address",
      origin_value: string | null,
      stops: string[],
      finish_hint: "none" | "address" | "place_query",
      finish_value: string | null,
      constraints: Array<[number, number]>
    };
    debugPlan.value = JSON.stringify(plan, null, 2);

    // 2) Build list including finish if provided
    const finishProvided = plan.finish_hint !== "none" && !!plan.finish_value;
    const combined = finishProvided ? [...plan.stops, plan.finish_value as string] : [...plan.stops];

    // 3) Resolve to coordinates via Places
    const homeAddress = localStorage.getItem("optipath_home_addr") || undefined;
    const { origin, stops } = await resolveChatPlan(
      { origin_hint: plan.origin_hint, origin_value: plan.origin_value, stops: combined },
      { homeAddress }
    );

    // 4) Split finish back out
    let finish: any | undefined = undefined;
    let stopsOnly = stops;
    if (finishProvided && stops.length) {
      finish = stops[stops.length - 1];
      stopsOnly = stops.slice(0, -1);
    }

    // 5) Emit normalized objects
    const toApp = (s: any) => ({
      formatted_address: s.formatted_address || s.name,
      name: s.name,
      latLng: s.latLng,
      isCurrentLocation: !!s.isCurrentLocation
    });

    emit("resolvedStops", {
      origin: toApp(origin),
      stops: stopsOnly.map(toApp),
      finish: finish ? toApp(finish) : undefined,
      constraints: plan.constraints || []
    });
  } catch (e: any) {
    console.error(e);
    alert(e.message || "Sorry—couldn’t process that request.");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.card { background: var(--card); border: 1px solid var(--border); }
</style>
