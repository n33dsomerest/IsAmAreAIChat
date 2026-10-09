/**
 * Phase 6 — conversation history, branching and export.
 *
 *   npm run test:conversations
 *
 * Runs on a real account against a real chat turn, so the branch tree under
 * test is the same one the UI walks.
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
const USER = `cv${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!cv';

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
  return { status: res.status, data: text.startsWith('{') ? JSON.parse(text) : text };
};

/** Reads the SSE body to completion and returns the reply text. */
async function chat(cookie, modelId, payload) {
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const conversationId = res.headers.get('x-conversation-id');
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
  return { status: res.status, conversationId, text, reasoning };
}

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

  /* One real turn creates the conversation ------------------------------- */
  const first = await chat(cookie, model.id, {
    modelId: model.id,
    messages: [{ role: 'user', parts: [{ type: 'text', text: 'ชื่ออะไร' }] }],
    maxOutputTokens: 512,
  });
  check(
    'first turn streams',
    first.status === 200 && (first.text.length > 0 || first.reasoning > 0),
    `text=${first.text.length} reasoning=${first.reasoning}`,
  );

  const conversationId = first.conversationId;
  check('conversation id is returned', Boolean(conversationId), conversationId ?? '');

  /* Assistant turn is persisted ---------------------------------------- */
  const view = await call(`/api/conversations/${conversationId}`, cookie);
  const turns = view.data.messages ?? [];
  check('both turns are stored', turns.length === 2, `${turns.length} turns`);
  check('the user turn comes first', turns[0]?.role === 'user', turns[0]?.role);
  check('the assistant turn was persisted', turns[1]?.role === 'assistant', `${JSON.stringify(turns[1]?.parts ?? '').slice(0, 40)}`);

  const title = view.data.conversation?.title ?? '';
  check('the conversation was titled from the prompt', title.length > 0 && title !== 'แชทใหม่', title);

  /* Ownership ------------------------------------------------------------ */
  const anon = await call(`/api/conversations/${conversationId}`);
  check('anonymous cannot read it', anon.status === 401, `status=${anon.status}`);

  const [other] = await sql`select id from public.users where id <> ${createdId} limit 1`;
  void other;

  /* Renaming, foldering, pinning ---------------------------------------- */
  const renamed = await call(`/api/conversations/${conversationId}`, cookie, {
    method: 'PATCH',
    body: JSON.stringify({ title: 'ชื่อที่ตั้งเอง', folder: 'งาน', pinned: true }),
  });
  check('conversation can be renamed', renamed.data.conversation?.title === 'ชื่อที่ตั้งเอง');
  check('a folder can be assigned', renamed.data.conversation?.folder === 'งาน');
  check('it can be pinned', renamed.data.conversation?.pinned === true);

  const list = await call('/api/conversations', cookie);
  check('it appears in the list', list.data.conversations?.some((c) => c.id === conversationId));
  check('the folder is reported', list.data.folders?.includes('งาน'), JSON.stringify(list.data.folders));

  /* Branching ------------------------------------------------------------ */
  const fork = await call(`/api/conversations/${conversationId}/branch`, cookie, {
    method: 'POST',
    body: JSON.stringify({ messageId: turns[0].id, text: 'ชื่ออะไร (ฉบับที่สอง)' }),
  });
  check('a user turn can be forked', fork.status === 200, `status=${fork.status}`);
  check(
    'the fork points at the same parent',
    fork.data.parentId === null,
    String(fork.data.parentId),
  );

  const forked = await sql`
    select id, parent_id, role from public.messages
     where conversation_id = ${conversationId} order by created_at`;
  check('nothing was deleted', forked.length === 3, `${forked.length} rows`);

  // Regenerate: the answer forks under the same user turn.
  const regen = await call(`/api/conversations/${conversationId}/branch`, cookie, {
    method: 'POST',
    body: JSON.stringify({ messageId: forked[1].id }),
  });
  check('an assistant turn can be regenerated', regen.status === 200, `status=${regen.status}`);
  check('the regeneration is a sibling', regen.data.parentId === forked[0].id, regen.data.parentId ?? '');

  /* Export --------------------------------------------------------------- */
  const exported = await fetch(`${APP}/api/conversations/${conversationId}?format=export`, {
    headers: { cookie },
  });
  const md = await exported.text();
  check('export is markdown', (exported.headers.get('content-type') ?? '').includes('text/markdown'), exported.status + ' ' + (exported.headers.get('content-type') ?? ''));
  check('it downloads as a file', (exported.headers.get('content-disposition') ?? '').includes('attachment'));
  check('the body carries the conversation', md.includes('ชื่อที่ตั้งเอง') || md.includes('ชื่ออะไร'), `${md.length} bytes`);

  /* Delete --------------------------------------------------------------- */
  const [before] = await sql`select count(*)::int as n from public.messages where conversation_id = ${conversationId}`;
  const removed = await call(`/api/conversations/${conversationId}`, cookie, { method: 'DELETE' });
  check('it can be deleted', removed.status === 200);
  const [after] = await sql`select count(*)::int as n from public.messages where conversation_id = ${conversationId}`;
  check('its messages cascade away', before.n > 0 && after.n === 0, `${before.n} → ${after.n}`);

} catch (err) {
  check('conversation run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);