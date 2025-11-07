<template>
  <div class="fab" role="toolbar" aria-label="Theme switch">
    <a class="brand" href="/" title="OptiPath">🧭 OptiPath</a>
    <button class="toggle" @click="$emit('toggle')">
      {{ theme === 'light' ? 'Light' : 'Dark' }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{ theme: 'light' | 'dark' }>()
defineEmits<{ (e: 'toggle'): void }>()
</script>

<style scoped>
.fab{
  position: fixed;
  top: 12px;
  right: 16px;
  z-index: 1200;               /* above map and sidebar */
  display: flex;
  gap: .5rem;
  align-items: center;
  padding: .4rem .6rem;
  border-radius: 999px;
  background: var(--card, rgba(20,20,20,.9));
  color: var(--text, #e5e7eb);
  border: 1px solid var(--border, rgba(255,255,255,.12));
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 24px rgba(0,0,0,.25);
}
.brand{
  text-decoration: none;
  font-weight: 800;
  letter-spacing: .2px;
  color: inherit;
  opacity: .85;
}
.toggle{
  padding: .35rem .6rem;
  border-radius: 999px;
  border: 1px solid var(--border, rgba(255,255,255,.12));
  background: var(--bg, #111827);
  color: inherit;
  font-weight: 700;
  cursor: pointer;
}
.toggle:hover{ filter: brightness(1.05); transform: translateY(-1px); }
@media (max-width: 640px){
  .brand{ display:none; }   /* keep it tiny on phones */
}
</style>
