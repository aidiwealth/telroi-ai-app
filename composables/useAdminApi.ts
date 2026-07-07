// composables/useAdminApi.ts
// Shared fetch wrapper for the platform-admin area. Centralizes the one thing
// every admin page kept getting wrong: only a real 401 (unauthenticated) should
// bounce the operator to the login page. A 403 (authenticated but not permitted),
// a 500, or a network blip must surface as an error — NOT silently log the
// operator out. Pages should use this instead of raw $fetch + ad-hoc catches.
export function useAdminApi() {
  async function call<T>(url: string, opts: any = {}): Promise<T> {
    try {
      return await $fetch<T>(url, opts);
    } catch (e: any) {
      const status = e?.response?.status || e?.statusCode || e?.status;
      if (status === 401) {
        // Genuinely unauthenticated — session gone. Send to admin login.
        await navigateTo('/admin/login');
        throw new Error('Session expired');
      }
      // Everything else: surface a clean message; the page decides how to show it.
      const msg = e?.data?.error?.message || e?.data?.message || e?.statusMessage || 'Something went wrong';
      throw new Error(msg);
    }
  }
  return {
    get: <T>(url: string, query?: any) => call<T>(url, { method: 'GET', query }),
    post: <T>(url: string, body?: any) => call<T>(url, { method: 'POST', body }),
    put: <T>(url: string, body?: any) => call<T>(url, { method: 'PUT', body }),
    patch: <T>(url: string, body?: any) => call<T>(url, { method: 'PATCH', body }),
    del: <T>(url: string, query?: any) => call<T>(url, { method: 'DELETE', query })
  };
}
