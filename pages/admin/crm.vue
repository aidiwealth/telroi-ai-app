<template>
  <CrmWorkspace api-base="/api/admin/support/crm" :admin="true" />
</template>
<script setup lang="ts">
definePageMeta({ layout: 'admin' });
useHead({ title: 'CRM — Telroi Admin' });
</script>
