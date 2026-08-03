<script setup lang="ts">
// /signup — the same page as /login with the create-account tab open. A path
// rather than a query string because this is what goes in an advert or an email,
// and ?mode=signup reads like plumbing. Kept as a redirect so signup can become
// its own page later — with plan selection, say — without changing the link.
definePageMeta({ layout: false });
await navigateTo({ path: '/login', query: { mode: 'signup' } }, { replace: true });
</script>

<template><div /></template>
