<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import { routes } from '@/router';
</script>

<template>
  <div class="w-full h-full overflow-hidden flex flex-col">
    <div class="border-b-1px mb-6px">
      <a v-for="route of routes" :key="route.name" :href="route.path" class="mr-10px bg-gray-200">
        &nbsp;&nbsp;{{ route.path }}&nbsp;&nbsp;
      </a>
    </div>
    <div class="w-full flex-1 overflow-hidden">
      <RouterView />
    </div>
  </div>
</template>

<style></style>
