// server/middleware/block-probes.ts
// Bot scanners constantly probe for config and admin files (.env, .git/config,
// wp-login.php, phpinfo.php...). Those are legitimate 404s, but rendering Nuxt's
// error page for them hits an upstream bug — @pinia/nuxt's shouldHydrate calls
// obj.hasOwnProperty on a null-prototype object in the error payload and throws,
// turning every probe into a logged 500 (nuxt/nuxt#32740, vuejs/pinia#2884).
//
// We answer these with a bare 404 before Nuxt's error handling runs: the crash
// can't happen, and the logs stay readable. Real 404s still render the normal
// error page.
const PROBE_PATTERNS = [
  /\/\.env($|[.\/])/i,        // .env, .env.local, .env/
  /\/\.git($|\/)/i,           // .git/config etc
  /\/\.aws($|\/)/i,
  /\/\.ssh($|\/)/i,
  /\/wp-(admin|login|content|includes)/i,
  /\/phpinfo\.php$/i,
  /\/phpmyadmin/i,
  /\/xmlrpc\.php$/i,
  /\/vendor\/phpunit/i,
  /\/\.well-known\/.*\.php$/i,
  /\.(php|asp|aspx|jsp|cgi)$/i, // we serve none of these
  /\/config\.(json|ya?ml|ini)$/i,
  /\/(backup|dump|db)\.(sql|zip|tar|gz)$/i
];

export default defineEventHandler((event) => {
  const path = event.path || '';
  if (!PROBE_PATTERNS.some((re) => re.test(path))) return;
  // Plain 404, no error page, no payload serialization.
  setResponseStatus(event, 404);
  setResponseHeader(event, 'content-type', 'text/plain');
  return 'Not Found';
});
