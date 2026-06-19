// control-app/src/config.ts
// Configuration for the Telroi ARI control app. All values come from the
// environment (set in a .env file on the Droplet, or real env vars). This app
// runs as a standalone Node process on the Asterisk Droplet — NOT inside Nuxt —
// so it never uses useRuntimeConfig(); it reads process.env directly.
import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  // --- ARI connection (to the local Asterisk on this same Droplet) ---
  // Because the control app runs ON the Asterisk box, it connects to ARI over
  // localhost plain HTTP (8088) — fast, never leaves the machine, no TLS needed
  // internally. The TLS 8089 path is for Telroi (App Platform) reaching in from
  // outside; this local app uses 8088 on localhost.
  ari: {
    url: process.env.ARI_URL || 'http://127.0.0.1:8088',
    username: required('ARI_USERNAME'),
    password: required('ARI_PASSWORD'),
    appName: process.env.ARI_APP_NAME || 'telroi'
  },

  // --- Database (the SAME Postgres Telroi uses; control app reads it directly) ---
  databaseUrl: required('DATABASE_URL'),

  // --- Behaviour flags ---
  // Stage 1 keeps things minimal: answer + play a message. Later stages flip
  // these on to enable real routing / blacklist / AI.
  logLevel: process.env.LOG_LEVEL || 'info'
};
