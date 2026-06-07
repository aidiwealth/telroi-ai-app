// GET /v1 -> API root (unauthenticated discovery)
export default defineEventHandler(() => ({
  name: 'Telroi API', version: 'v1',
  docs: useRuntimeConfig().public.appBaseUrl + '/developers',
  resources: ['/v1/calls', '/v1/numbers', '/v1/agents', '/v1/vans'],
  auth: 'Bearer tlr_live_... (Authorization header)'
}));
