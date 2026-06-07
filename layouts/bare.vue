<template>
  <div class="bare">
    <div class="bare-brand">
      <img src="https://pub-f138f42d66b748108ebf7432c7314665.r2.dev/telroi-ll.png" alt="Telroi" />
    </div>
    <main class="bare-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts"></script>

<style>
/* When the sign-in page opts in, vertically center its card and hide the
   layout's top logo (the sign-in page renders its own centered logo). This
   does NOT affect the tall multi-step setup wizard, which stays top-aligned. */
body.signin-centered .bare-brand { display: none; }
body.signin-centered .bare-main { align-items: center; padding-top: 0; padding-bottom: 0; }
</style>

<style scoped>
.bare {
  min-height: 100vh;
  background: radial-gradient(120% 80% at 50% -10%, #e7eef4 0%, transparent 55%), #f7f6f3;
  display: flex;
  flex-direction: column;
  align-items: center;
}
/* Single, centered logo for the whole auth/onboarding experience. */
.bare-brand { padding: 40px 24px 8px; }
.bare-brand img { height: 30px; display: block; }
.bare-main {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 3vh 24px 8vh;
}
</style>
