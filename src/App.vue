<script setup lang="ts">
import MainPage from './pages/MainPage.vue'
import Navbar from './components/Navbar.vue'
import { ref, onMounted } from 'vue'

// light dark theme 
type Theme = 'light' | 'dark'
const theme = ref<Theme>('light')

function apply(t: Theme) {
  theme.value = t
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem('theme', t)
}

function toggleTheme() {
  apply(theme.value === 'light' ? 'dark' : 'light')
}

onMounted(() => {
  const saved = localStorage.getItem('theme') as Theme | null
  if (saved === 'light' || saved === 'dark') return apply(saved)
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  apply(prefersDark ? 'dark' : 'light')
})
</script>

<template>
  <div id="app">
    <Navbar />

    <!-- Theme toggle -->
    <div style="text-align:right; padding: 0.5rem 1rem;">
      <button
        @click="toggleTheme"
        :aria-pressed="theme === 'dark'"
        aria-label="Toggle color theme"
        title="Toggle color theme"
      >
        <span v-if="theme === 'dark'">Light Mode</span>
        <span v-else>Dark Mode</span>
      </button>
    </div>

    <MainPage />
  </div>
</template>

<style scoped>
#app {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
button {
  border-radius: 8px;
  border: 1px solid var(--border);
  padding: 0.6em 1.2em;
  font-size: 0.95rem;
  font-weight: 600;
  font-family: inherit;
  background-color: var(--card);
  color: var(--text);
  cursor: pointer;
  transition: border-color .2s ease, background-color .2s ease, color .2s ease;
}
button:hover { border-color: var(--accent); }
</style>
