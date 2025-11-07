<script setup lang="ts">
import { ref, onMounted } from 'vue'
import MainPage from './pages/MainPage.vue'
import ThemeToggleFab from './components/ThemeToggleFab.vue'

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
  <MainPage />
  <ThemeToggleFab :theme="theme" @toggle="toggleTheme" />
</template>
