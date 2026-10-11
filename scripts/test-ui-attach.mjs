/**
 * Clicks the attach button in a real browser and checks that a file actually
 * gets uploaded and listed.
 *
 * This exists because the API tests passed the whole time the button was dead.
 * The cause was a live `FileList`: the handler handed it to an async function
 * and then cleared the input in the same tick, so the list the upload later
 * read was already empty. Nothing was requested, nothing was listed, nothing
 * errored — and with no toast mounted, nothing appeared on screen either.
 * Every test that stops at the HTTP layer is blind to that class of bug.
 *
 * Needs Chrome. Skips rather than fails when there is nothing to drive.
 */
import { existsSync } from 'node:fs';

const APP = process.env.APP_URL ?? 'http://localhost:3000';
const PORT = process.env.CDP_PORT ?? '9222';

const CHROME = [
  `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
].find((p) => p && existsSync(p));

const cdpUp = await fetch(`http://127.0.0.1:${PORT}/json/version`)
  .then(() => true)
  .catch(() => false);

if (!CHROME || !cdpUp) {
  console.log(`⏭  no browser to drive — skipped.`);
  console.log(`   start one with: "${CHROME ?? 'chrome'}" --remote-debugging-port=${PORT}`);
  process.exit(0);
}

const { createServerClient } = await import('@supabase/ssr');

const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── a signed-in session with one conversation ─────────────────────────────── */
const jar = new Map();
const client = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) => {
        for (const { name, value } of l) jar.set(name, value);
      },
    },
  },
);
const USER = `ui${Date.now().toString(36)}`;
let userId = null;
let conversationId = null;

try {
  const { data, error } = await client.auth.signUp({
    email: `${USER}@example.com`,
    password: 'Passw0rd!ui',
    options: { data: { username: USER } },
  });
  if (error) throw new Error(`signup: ${error.message}`);
  userId = data.user.id;

  const headers = { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; ') };
  conversationId = (await (await fetch(`${APP}/api/conversations`, { method: 'POST', headers })).json()).id;

  /* ── drive the page ───────────────────────────────────────────────────────── */
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  const net = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
    if (m.method === 'Network.responseReceived' && m.params.response.url.includes('/api/attachments')) {
      net.push(m.params.response.status);
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) {
      return { THREW: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    }
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Network.enable');
  for (const [name, value] of jar) {
    await send('Network.setCookie', { name, value, domain: 'localhost', path: '/' });
  }
  await send('Page.navigate', { url: `${APP}/chat/${conversationId}` });
  await new Promise((r) => setTimeout(r, 6000));

  check('the attach button is on the page', await evaluate(`!!document.querySelector('[aria-label="แนบไฟล์"]')`));
  check(
    'a toast surface exists, so failures are not silent',
    await evaluate(`!!document.querySelector('section[aria-label*="Notifications"], [data-sonner-toaster]')`),
  );

  const picked = await evaluate(`(async () => {
    const input = document.querySelector('input[type="file"]');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(120000)], 'probe.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5000));
    return {
      chips: document.querySelectorAll('[aria-label^="เอา "]').length,
      listed: document.body.innerText.includes('probe.jpg'),
    };
  })()`);

  check('picking a file uploads it', net.includes(201), `POST /api/attachments -> ${net.join(',') || 'never called'}`);
  check('the file is listed in the composer', picked?.chips > 0, `${picked?.chips} chips`);
  check('the filename is visible', picked?.listed === true);

  ws.close();
} finally {
  if (conversationId && jar.size) {
    await fetch(`${APP}/api/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: { cookie: [...jar].map(([n, v]) => `${n}=${v}`).join('; ') },
    }).catch(() => {});
  }
  if (userId) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
    await sql`delete from auth.users where id = ${userId}`.catch(() => {});
    await sql.end();
  }
}

const failed = results.filter((r) => !r).length;
console.log(`\n${failed ? `${failed} FAILED` : `all ${results.length} checks passed`}`);
process.exit(failed ? 1 : 0);