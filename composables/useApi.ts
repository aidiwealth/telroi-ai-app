// Thin wrapper around $fetch that surfaces the { error: { code, message } } envelope.
export function useApi() {
  async function call<T>(url: string, opts: any = {}): Promise<T> {
    try {
      return await $fetch<T>(url, opts);
    } catch (e: any) {
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
