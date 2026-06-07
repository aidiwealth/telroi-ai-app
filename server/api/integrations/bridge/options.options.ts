// CORS preflight for the bridge endpoints (called cross-origin from inside the CRM).
export default defineEventHandler((event) => {
  setHeader(event, 'access-control-allow-origin', '*');
  setHeader(event, 'access-control-allow-methods', 'GET,POST,OPTIONS');
  setHeader(event, 'access-control-allow-headers', 'content-type');
  setResponseStatus(event, 204);
  return '';
});
