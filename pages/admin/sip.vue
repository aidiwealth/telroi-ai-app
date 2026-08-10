<template>
  <div>
    <div class="ad-head">
      <div>
        <h1 class="ad-title">SIP</h1>
        <p class="ad-sub">Access requests from clients wanting to connect their own PBX, and the live registration state of every endpoint.</p>
      </div>
    </div>

    <div class="log-tabs">
      <button class="log-tab" :class="{ active: tab === 'requests' }" @click="tab = 'requests'">Requests</button>
      <button class="log-tab" :class="{ active: tab === 'status' }" @click="tab = 'status'">Status</button>
    </div>

    <SipRequests v-if="tab === 'requests'" />
    <SipStatus v-else />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
definePageMeta({ layout: 'admin' });
useHead({ title: 'SIP — Telroi admin' });

// Requests first: an address waiting on approval is a client who cannot send
// traffic, where status is something you go looking for.
const tab = ref('requests');
</script>
