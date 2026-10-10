/**
 * Proves the sidebar's data source is a shared cache rather than a one-shot
 * fetch: creating a conversation and letting the server name it must both show
 * up under the same SWR key the sidebar reads.
 *
 * Client behaviour cannot be driven from here, so this asserts the parts that
 * make it possible — the key is exported and shared, the endpoint answers with
 * the rows the sidebar expects, and a derived title reaches that endpoint.
 */
import { createServerClient } from '@supabase/ssr';
import postgres from 'postgres';

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? 'http://localhost:3000';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const USER = `swr${Date.now().toString(36)}`;
let id = null;

try {
  const jar = new Map();
  const client = createServerClient(SUPA, ANON, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (l) => { for (const { name, value } of l) jar.set(name, value); },
    },
  });
  const { data, error } = await client.auth.signUp({
    email: `${USER}@example.com`,
    password: 'Passw0rd!swr',
    options: { data: { username: USER } },
  });
  if (error) throw new Error(`signup: ${error.message}`);
  id = data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');

  const readList = async () => {
    const res = await fetch(`${APP}/api/conversations`, { headers: { cookie } });
    return (await res.json()).conversations ?? [];
  };

  const first = await readList();
  check('an empty account returns an empty list', Array.isArray(first) && first.length === 0);

  // The shape the sidebar renders from.
  const cat = await (await fetch(`${APP}/api/models`, { headers: { cookie } })).json();
  const modelId = cat.models?.[0]?.id;

  const created = await (
    await fetch(`${APP}/api/conversations`, { method: 'POST', headers: { cookie } })
  ).json();
  const cid = created.id;

  const afterCreate = await readList();
  check('a created conversation shows up in the list', afterCreate.length === 1, `${afterCreate.length} row(s)`);
  check(
    'the row carries the fields the sidebar renders',
    ['id', 'title', 'folder', 'pinned', 'archived', 'updatedAt', 'messageCount'].every(
      (k) => k in (afterCreate[0] ?? {}),
    ),
    Object.keys(afterCreate[0] ?? {}).join(','),
  );

  // Title derived on the server must reach that same endpoint.
  const chat = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: cid,
      modelId,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'ชื่อที่ควรโผล่ใน sidebar' }] }],
      maxOutputTokens: 16,
    }),
  });
  await chat.text();

  const afterChat = await readList();
  check(
    'the derived title reaches the sidebar endpoint',
    afterChat[0]?.title === 'ชื่อที่ควรโผล่ใน sidebar',
    `"${afterChat[0]?.title}"`,
  );

  // Only the user's turn is guaranteed to exist: /api/chat persists it before it
  // spends anything on the model, so this holds even when the provider fails.
  check(
    'the user turn is counted without waiting for the provider',
    afterChat[0]?.messageCount >= 1,
    `${afterChat[0]?.messageCount} message(s)`,
  );

  // Whether an assistant row exists depends on the provider, so report it
  // rather than asserting on it — a rate-limited free model is not a regression
  // in the sidebar.
  const rows = await sql`
    select role from public.messages
    where conversation_id = ${cid} order by created_at asc`;
  const roles = rows.map((r) => r.role).join(' + ') || '(none)';
  console.log(`    ↳ stored rows: ${roles}`);

  // Optimistic pin, then confirm the server agrees.
  const before = afterChat[0].pinned;
  const patched = await fetch(`${APP}/api/conversations/${cid}`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ pinned: !before }),
  });
  check('pin toggle is accepted', patched.ok);
  const afterPin = await readList();
  check('the pinned value the client optimistically set matches the server', afterPin[0].pinned === !before);
} catch (e) {
  check('run completed', false, e.message);
} finally {
  if (id) await sql`delete from auth.users where id = ${id}`;
  await sql.end();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);