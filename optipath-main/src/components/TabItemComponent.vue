<script setup lang="ts">

const props = defineProps({
  index: Number,
  subtitle: String,
  activeTab: Number
});


</script>

<template >
  <div v-show="activeTab == index">
    <h4>{{ subtitle }}</h4>
    <slot/>
  </div>
</template>

<style scoped>

</style>