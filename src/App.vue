<script setup lang="ts">
import MainPage from './pages/MainPage.vue'
import Navbar from "./components/Navbar.vue"
import { ref, onMounted } from 'vue'

// light/dark theme state
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
  if (saved === 'light' || saved === 'dark') {
    return apply(saved)
  }
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  apply(prefersDark ? 'dark' : 'light')
})
</script>

<template>
  <div id="app">
    <!-- Navbar -->
    <Navbar />

    <!-- Theme toggle button -->
    <div style="text-align:right; padding: 0.5rem 1rem;">
      <button @click="toggleTheme">
        {{ theme === 'dark' ? '️Light Mode' : 'Dark Mode' }}
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
  font-size: 1em;
  font-weight: 500;
  font-family: inherit;
  background-color: var(--card);
  color: var(--text);
  cursor: pointer;
  transition: border-color 0.25s;
}
button:hover {
  border-color: var(--accent);
}
</style>

