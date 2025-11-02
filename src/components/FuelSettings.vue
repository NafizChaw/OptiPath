<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';

export type FuelSettings = {
  enabled: boolean;
  currentFuelPercent: number;
  tankCapacityGallons: number;
  mpg: number;
  refuelThresholdPercent: number;
};

const props = defineProps<{ modelValue: FuelSettings }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: FuelSettings): void }>();

const enabled     = ref(props.modelValue.enabled);
const currentFuel = ref(props.modelValue.currentFuelPercent);
const tank        = ref(props.modelValue.tankCapacityGallons);
const mpg         = ref(props.modelValue.mpg);
const threshold   = ref(props.modelValue.refuelThresholdPercent);
const expanded    = ref(false);

const presets = [
  { name: 'Compact Car', tank: 12, mpg: 32 },
  { name: 'Sedan',       tank: 15, mpg: 28 },
  { name: 'SUV',         tank: 18, mpg: 22 },
  { name: 'Truck',       tank: 26, mpg: 18 },
  { name: 'Hybrid',      tank: 11, mpg: 50 },
  { name: 'Custom',      tank: 0,  mpg: 0  },
];
const selPreset = ref('Custom');

const gallonsNow = computed(() => ((currentFuel.value / 100) * tank.value).toFixed(1));
const rangeNow   = computed(() => ( (currentFuel.value / 100) * tank.value * mpg.value ).toFixed(0));

function push() {
  emit('update:modelValue', {
    enabled: enabled.value,
    currentFuelPercent: currentFuel.value,
    tankCapacityGallons: tank.value,
    mpg: mpg.value,
    refuelThresholdPercent: threshold.value,
  });
}
watch([enabled, currentFuel, tank, mpg, threshold], push);

function applyPreset(name: string) {
  const p = presets.find(x => x.name === name);
  if (!p || p.name === 'Custom') return;
  tank.value = p.tank; mpg.value = p.mpg; selPreset.value = p.name;
  push();
}

onMounted(() => {
  const saved = localStorage.getItem('optipath_fuel_settings');
  if (!saved) return;
  try {
    const v = JSON.parse(saved);
    enabled.value   = v.enabled ?? false;
    currentFuel.value = v.currentFuelPercent ?? 75;
    tank.value      = v.tankCapacityGallons ?? 15;
    mpg.value       = v.mpg ?? 25;
    threshold.value = v.refuelThresholdPercent ?? 25;
    push();
  } catch {}
});

watch(() => props.modelValue, v => {
  localStorage.setItem('optipath_fuel_settings', JSON.stringify(v));
}, { deep: true });
</script>

<template>
  <div class="fuel">
    <div class="head" @click="expanded = !expanded">
      <div class="row">
        <span class="icon"></span>
        <span class="title">Fuel Management</span>
      </div>
      <div class="row">
        <label class="toggle">
          <input type="checkbox" v-model="enabled" @click.stop />
          <span>{{ enabled ? 'On' : 'Off' }}</span>
        </label>
        <span class="chev">{{ expanded ? '▼' : '▶' }}</span>
      </div>
    </div>

    <div v-if="expanded">
      <div class="line">
        <label>Vehicle</label>
        <select v-model="selPreset" @change="applyPreset(selPreset)">
          <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
        </select>
      </div>

      <div class="line">
        <label>Fuel: {{ currentFuel }}% ({{ gallonsNow }} gal) • Range: ~{{ rangeNow }} mi</label>
        <input type="range" min="0" max="100" step="5" v-model.number="currentFuel" />
      </div>

      <div class="grid">
        <div class="line">
          <label>Tank (gal)</label>
          <input type="number" min="5" max="50" step="0.5" v-model.number="tank" />
        </div>
        <div class="line">
          <label>MPG</label>
          <input type="number" min="5" max="100" step="1" v-model.number="mpg" />
        </div>
      </div>

      <div class="line">
        <label>Refuel at {{ threshold }}%</label>
        <input type="range" min="10" max="50" step="5" v-model.number="threshold" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.fuel{ background:var(--bg); border:1px solid var(--border); border-radius:12px; overflow:hidden; }
.head{ padding:.8rem 1rem; display:flex; align-items:center; justify-content:space-between; cursor:pointer; }
.row{ display:flex; align-items:center; gap:.6rem; }
.icon{ font-size:1.1rem; }
.title{ font-weight:600; }
.toggle{ display:flex; align-items:center; gap:.4rem; }
.chev{ color:var(--muted); font-size:.85rem; }
.line{ display:flex; flex-direction:column; gap:.35rem; padding: .6rem 1rem; }
.grid{ display:grid; grid-template-columns:1fr 1fr; gap:.5rem; padding:0 1rem 1rem; }
input[type="number"], select{ padding:.45rem .55rem; border:1px solid var(--border); border-radius:8px; background:var(--card); color:var(--text); }
input[type="range"]{ width:100%; accent-color:var(--accent); }
</style>
