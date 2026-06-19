// control-app/src/config.ts
// Configuration for the Telroi ARI control app. All values come from the
// environment (a .env file on the host, or real env vars). This app runs as a
// standalone Node process, NOT inside Nuxt, so it reads process.env directly.
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
  // --- ARI connection ---
  // IMPORTANT: ARI_URL must be PROTOCOL + HOST only (no /ari path) — the
  // ari-client library appends /ari itself. Examples:
  //
  //   • Control app co-located with Asterisk (London box):
  //       ARI_URL=http://127.0.0.1:8088        (localhost, plain HTTP, instant)
  //
  //   • Control app on a DIFFERENT box from Asterisk (e.g. NYC -> London PBX):
  //       ARI_URL=https://sip.telroi.ai:8089   (public TLS; the lib derives
  //       wss://sip.telroi.ai:8089/ari/events for the event stream)
  //
  // NOTE: when the control app is NOT on the Asterisk box, every ARI command in
  // the call path (answer/play/bridge) crosses the network to Asterisk. Across
  // the Atlantic that adds ~80ms per action. Co-locating with Asterisk avoids it.
  ari: {
    url: process.env.ARI_URL || 'http://127.0.0.1:8088',
    username: required('ARI_USERNAME'),
    password: required('ARI_PASSWORD'),
    appName: process.env.ARI_APP_NAME || 'telroi'
  },

  // --- Database (the SAME Postgres the main app uses) ---
  databaseUrl: required('DATABASE_URL'),

  logLevel: process.env.LOG_LEVEL || 'info'
};
