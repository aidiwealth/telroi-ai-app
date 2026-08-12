// control-app/src/ami.ts
// A small AMI client, for the one thing ARI cannot do.
//
// Recording has to be MixMonitor: ARI's channel.record() captures what a caller
// says and not what they hear, and its bridge recording only exists once
// somebody has answered — which would miss the notice and the whole AI
// conversation. MixMonitor is an AMI action, and starting it this way leaves the
// channel in Stasis, where continueInDialplan would take it out, fire StasisEnd,
// and have the routing run a second time on its return.
//
// Deliberately minimal: one connection, reconnected when it drops, and no
// attempt to be a general AMI library. Recording is all it does.
import net from 'node:net';

const HOST = process.env.AMI_HOST || '127.0.0.1';
const PORT = Number(process.env.AMI_PORT || 5038);
const USER = process.env.AMI_USERNAME || '';
const PASS = process.env.AMI_PASSWORD || '';

function log(...a: unknown[]) { console.log(new Date().toISOString(), '[ami]', ...a); }

let sock: net.Socket | null = null;
let authed = false;
let actionId = 0;
const pending = new Map<string, (ok: boolean, msg: string) => void>();

export function amiAvailable(): boolean { return !!(USER && PASS); }

function connect(): void {
  if (!amiAvailable() || sock) return;
  const s = net.connect(PORT, HOST);
  sock = s;
  let buf = '';

  s.on('connect', () => {
    s.write(`Action: Login\r\nUsername: ${USER}\r\nSecret: ${PASS}\r\n\r\n`);
  });

  s.on('data', (d) => {
    buf += d.toString();
    // AMI frames end with a blank line.
    let i: number;
    while ((i = buf.indexOf('\r\n\r\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 4);
      const fields: Record<string, string> = {};
      for (const line of frame.split('\r\n')) {
        const c = line.indexOf(':');
        if (c > 0) fields[line.slice(0, c).trim().toLowerCase()] = line.slice(c + 1).trim();
      }
      if (/authentication accepted/i.test(fields.message || '')) { authed = true; log('authenticated'); }
      const id = fields.actionid;
      if (id && pending.has(id)) {
        pending.get(id)!(/success/i.test(fields.response || ''), fields.message || '');
        pending.delete(id);
      }
    }
  });

  const drop = (why: string) => {
    if (sock !== s) return;
    authed = false; sock = null;
    log(`disconnected (${why}) — retrying in 5s`);
    // Recording is not worth crashing the control app for; a call that goes
    // unrecorded is a lost file, where an exception here is a lost call.
    setTimeout(connect, 5000);
  };
  s.on('error', (e) => drop(e.message));
  s.on('close', () => drop('closed'));
}

export function startAmi(): void {
  if (!amiAvailable()) { log('no credentials — recording disabled'); return; }
  connect();
}

/** Begin recording a channel. Resolves false rather than throwing: a recording
 *  that cannot start is a file nobody gets, not a call nobody gets. */
export async function startRecording(channel: string, file: string): Promise<boolean> {
  // Connected on first use rather than at boot: recording is occasional, the
  // connection costs nothing to hold, and a boot hook is one more thing to
  // forget — which would leave every recording failing quietly.
  if (!sock) { connect(); await new Promise((r) => setTimeout(r, 1500)); }

  return new Promise((resolve) => {
    if (!sock || !authed) { log('not connected — cannot record'); return resolve(false); }
    const id = String(++actionId);
    const timer = setTimeout(() => { pending.delete(id); resolve(false); }, 5000);
    pending.set(id, (ok, msg) => { clearTimeout(timer); if (!ok) log(`MixMonitor refused: ${msg}`); resolve(ok); });
    sock.write(
      `Action: MixMonitor\r\nActionID: ${id}\r\nChannel: ${channel}\r\nFile: ${file}\r\nOptions: \r\n\r\n`
    );
  });
}
