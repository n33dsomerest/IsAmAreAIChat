/**
 * The empty session that "แชทใหม่" resolves to.
 *
 *   npm run test:draft-session
 *
 * The composer used to insert a conversation on every visit to `/` and on every
 * file attachment, which is how a user accumulated several indistinguishable
 * `แชทใหม่` rows and lost the reply that was already streaming. These checks
 * pin the replacement behaviour: one reusable empty session, the URL held at `/`
 * until a message is actually sent, and the title derived at that moment.
 */
import { createServerClient } from '@supabase/ssr';
import postgres from 'postgres';

const APP = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || 'users.aichat.app';

if (!SUPA || !ANON) {
  console.error('Supabase env vars missing');
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const USER = `ds${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!ds';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let createdId = null;

function clientWithJar(jar) {
  return createServerClient(SUPA, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (list) => {
        for (const { name, value } of list) jar.set(name, value);
      },
    },
  });
}

const call = async (path, cookie, init) => {
  const res = await fetch(`${APP}${path}`, {
    redirect: 'manual',
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, url: res.url, data: text.startsWith('{') ? JSON.parse(text) : text };
};

async function chat(cookie, payload) {
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let text = '';
  let reasoning = 0;
  if (res.body) {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
        const e = JSON.parse(line.slice(6));
        if (e.type === 'text-delta') text += e.text;
        if (e.type === 'reasoning-delta') reasoning += (e.text ?? '').length;
      }
    }
  }
  return { status: res.status, conversationId: res.headers.get('x-conversation-id'), text, reasoning };
}

const rows = () => sql`select id, title from public.conversations where user_id = ${createdId} order by created_at`;

try {
  const jar = new Map();
  const supabase = clientWithJar(jar);
  const { data, error } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { username: USER } },
  });
  if (error || !data.user) throw new Error(`signup failed: ${error?.message}`);
  createdId = data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  check('fixture created', true, USER);

  const { models } = (await call('/api/models', cookie)).data;
  const model = models[0];
  check('a model is available', Boolean(model?.id), model?.label ?? '');

  /* ── signing in lands in an empty session ─────────────────────────────── */
  const first = await call('/', cookie);
  check('the landing page renders', first.status === 200, `status=${first.status}`);

  let all = await rows();
  check('landing created exactly one conversation', all.length === 1, `${all.length} rows`);
  const draft = all[0]?.id;
  check('the conversation has no messages', (await sql`select 1 from public.messages where conversation_id = ${draft}`).length === 0);
  check('it is named แชทใหม่ until someone speaks', all[0]?.title === 'แชทใหม่', all[0]?.title ?? '');

  /* ── the URL stays at / while the session is empty ────────────────────── */
  check('the landing URL is not rewritten to /chat/<id>', (first.url ?? '').endsWith('/'), first.url ?? '');

  /* ── pressing แชทใหม่ again reuses it ─────────────────────────────────── */
  await call('/', cookie);
  await call('/', cookie);
  all = await rows();
  check('pressing แชทใหม่ three times still yields one session', all.length === 1, `${all.length} rows`);
  check('and it is the same session', all[0]?.id === draft, all[0]?.id ?? '');

  /* ── an attachment needs no conversation of its own ───────────────────── */
  const form = new FormData();
  form.append('conversationId', draft);
  form.append('file', new Blob(['hello draft'], { type: 'text/plain' }), 'draft.txt');
  const uploaded = await call('/api/attachments', cookie, { method: 'POST', body: form });
  check('an attachment attaches to the empty session', uploaded.status === 201, `status=${uploaded.status}`);

  /* ── sending the first message names it ───────────────────────────────── */
  const sent = await chat(cookie, {
    conversationId: draft,
    modelId: model.id,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'ทดสอบชื่อ session' }] }],
    maxOutputTokens: 512,
  });
  check(
    'the first message streams',
    sent.status === 200 && (sent.text.length > 0 || sent.reasoning > 0),
    `text=${sent.text.length} reasoning=${sent.reasoning}`,
  );
  check('the stream reports the same conversation', sent.conversationId === draft, sent.conversationId ?? '');

  const [renamed] = await rows();
  check('the session keeps its id', renamed.id === draft, renamed.id);
  check('and is renamed from the prompt', renamed.title === 'ทดสอบชื่อ session', renamed.title);
  check('the reply is on disk for the page the URL now points at', (await sql`select 1 from public.messages where conversation_id = ${draft}`).length === 2);

  /* ── แชทใหม่ from a chat with history opens a different session ──────── */
  await call('/', cookie);
  all = await rows();
  const drafts = all.filter((r) => r.title === 'แชทใหม่');
  check('a new empty session is opened alongside the used one', drafts.length === 1, `${all.length} rows`);
  check('the used session is untouched', all.some((r) => r.id === draft && r.title === 'ทดสอบชื่อ session'));
  check('the new session is a different id', drafts[0]?.id !== draft, drafts[0]?.id ?? '');

  await call('/', cookie);
  all = await rows();
  check('and pressing แชทใหม่ again stays in that one', all.filter((r) => r.title === 'แชทใหม่').length === 1, `${all.length} rows`);

  /* ── the empty session is reachable by id, as the client navigates ───── */
  const active = all.find((r) => r.title === 'แชทใหม่');
  const opened = await call(`/chat/${active.id}`, cookie);
  check('the session has a page of its own', opened.status === 200, `status=${opened.status}`);
  check('it opens empty', (await sql`select 1 from public.messages where conversation_id = ${active.id}`).length === 0);

  const listed = await call('/api/conversations', cookie);
  check(
    'the sidebar lists the used session first',
    listed.data.conversations?.[0]?.id === draft,
    listed.data.conversations?.[0]?.id ?? '',
  );
} catch (err) {
  check('draft-session run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);