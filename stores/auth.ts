// stores/auth.ts
import { defineStore } from 'pinia';

interface MeUser { id: string; email: string; role: string | null; }
interface MeTenant { id: string; name: string; slug: string; timezone: string; country?: string | null; onboardingStep: number; provisioned: boolean; sandbox?: boolean; }

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as MeUser | null,
    tenant: null as MeTenant | null,
    loaded: false
  }),
  getters: {
    isAuthed: (s) => !!s.user,
    needsOnboarding: (s) => !!s.user && (!s.tenant || s.tenant.onboardingStep < 5)
  },
  actions: {
    async fetchMe() {
      // The browser sends the session cookie automatically on the client.
      // The universal auth plugin handles first-load hydration (forwarding the
      // cookie during SSR); this action is a simple refresh used after login or
      // when the middleware finds the store not yet loaded.
      try {
        const data = await $fetch<{ user: MeUser | null; tenant: MeTenant | null }>('/api/auth/me');
        // Normalize to plain-prototype objects (see plugins/auth.ts).
        this.user = data.user ? JSON.parse(JSON.stringify(data.user)) : null;
        this.tenant = data.tenant ? JSON.parse(JSON.stringify(data.tenant)) : null;
      } catch {
        this.user = null;
        this.tenant = null;
      } finally {
        this.loaded = true;
      }
    },
    async logout() {
      await $fetch('/api/auth/logout', { method: 'POST' });
      this.user = null;
      this.tenant = null;
      await navigateTo('/login');
    }
  }
});
