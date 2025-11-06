<template>
  <div class="llm-chat-compact">
    <div class="chat-header" @click="expanded = !expanded">
      <div class="header-content">
        <span class="icon"></span>
        <span class="title">AI Assistant</span>
      </div>
      <span class="toggle-icon">{{ expanded ? '▼' : '▶' }}</span>
    </div>

    <div v-if="expanded" class="chat-body">
      <div class="quick-tip">
        Try: "from home to Walmart, then Target, pick up gas"
      </div>

      <textarea 
        v-model="input" 
        class="chat-input" 
        rows="3"
        placeholder="Describe your route in plain English..."
        @keydown.enter.ctrl="submit"
      ></textarea>

      <div class="chat-actions">
        <button 
          class="btn-submit" 
          :disabled="loading || !input.trim()" 
          @click="submit"
        >
          {{ loading ? '🔄 Processing...' : '✨ Add Stops' }}
        </button>
        <button class="btn-secondary" @click="setHome">
          🏠 Set Home
        </button>
      </div>

      <div v-if="debugPlan" class="debug-section">
        <details>
          <summary class="debug-toggle">View parsed plan</summary>
          <pre class="debug-content">{{ debugPlan }}</pre>
        </details>
      </div>
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
const expanded = ref(false);

function setHome() {
  const cur = localStorage.getItem("optipath_home_addr") || "";
  const next = prompt("Enter your Home address (or coordinates):", cur);
  if (next) {
    localStorage.setItem("optipath_home_addr", next);
    alert("✅ Home address saved!");
  }
}

async function submit() {
  if (!input.value.trim()) return;
  loading.value = true;
  debugPlan.value = null;

  try {
    await ensureGoogleLoaded();

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

    const finishProvided = plan.finish_hint !== "none" && !!plan.finish_value;
    const combined = finishProvided ? [...plan.stops, plan.finish_value as string] : [...plan.stops];

    const homeAddress = localStorage.getItem("optipath_home_addr") || undefined;
    const { origin, stops } = await resolveChatPlan(
      { origin_hint: plan.origin_hint, origin_value: plan.origin_value, stops: combined },
      { homeAddress }
    );

    let finish: any | undefined = undefined;
    let stopsOnly = stops;
    if (finishProvided && stops.length) {
      finish = stops[stops.length - 1];
      stopsOnly = stops.slice(0, -1);
    }

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

    input.value = "";
  } catch (e: any) {
    console.error(e);
    alert(e.message || "Sorry—couldn't process that request.");
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.llm-chat-compact {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
  margin-bottom: 1rem;
}

.chat-header {
  padding: 0.75rem 1rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}

.chat-header:hover {
  background: color-mix(in srgb, var(--accent) 5%, var(--bg));
}

.header-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.icon {
  font-size: 1.2rem;
}

.title {
  font-weight: 600;
  color: var(--text);
}

.toggle-icon {
  color: var(--muted);
  font-size: 0.8rem;
}

.chat-body {
  padding: 1rem;
  border-top: 1px solid var(--border);
}

.quick-tip {
  font-size: 0.85rem;
  color: var(--muted);
  font-style: italic;
  margin-bottom: 0.75rem;
  padding: 0.5rem;
  background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  border-radius: 6px;
}

.chat-input {
  width: 100%;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--card);
  color: var(--text);
  font-family: inherit;
  font-size: 0.95rem;
  resize: vertical;
  margin-bottom: 0.75rem;
  transition: border-color 0.2s;
}

.chat-input:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-submit {
  flex: 1;
  padding: 0.75rem;
  background: var(--accent);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-submit:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
}

.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.75rem 1rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text);
}

.btn-secondary:hover {
  border-color: var(--accent);
}

.debug-section {
  margin-top: 1rem;
}

.debug-toggle {
  font-size: 0.85rem;
  color: var(--muted);
  cursor: pointer;
  user-select: none;
}

.debug-toggle:hover {
  color: var(--accent);
}

.debug-content {
  margin-top: 0.5rem;
  padding: 0.75rem;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.75rem;
  max-height: 150px;
  overflow: auto;
  color: var(--text);
}
</style>