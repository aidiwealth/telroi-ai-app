<template>
  <AiUsageWorkspace usage-base="/api/admin/support/ai/usage" />
</template>
<script setup lang="ts">
definePageMeta({ layout: 'admin' });
useHead({ title: 'AI Usage — Admin' });
</script>
