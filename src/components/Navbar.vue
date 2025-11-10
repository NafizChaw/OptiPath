<!-- <script setup lang="ts">
const props = defineProps<{ theme?: 'light' | 'dark' }>()
const emit = defineEmits<{ (e: 'toggleTheme'): void }>()
const onToggle = () => emit('toggleTheme')
</script>

<template>
  <nav class="app-nav">
    <div class="nav-left">
      <img
        class="nav-logo"
        src="/src/assets/images/logo-bg-tp.png"
        alt="OptiPath logo"
      />
    </div>

    <div class="nav-actions">
      <button
        class="nav-btn"
        type="button"
        @click="onToggle"
        :aria-pressed="props.theme === 'dark'"
        aria-label="Toggle color theme"
        title="Toggle color theme"
      >
        <span v-if="props.theme === 'dark'">Light</span>
        <span v-else>Dark</span>
      </button>
    </div>
  </nav>
</template> -->
