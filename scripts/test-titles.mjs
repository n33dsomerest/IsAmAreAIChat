/**
 * Proves the auto-title behaves: a placeholder becomes the first prompt, and a
 * name the user chose is never overwritten. Talks to the running dev server.
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

const USER = `ttl${Date.now().toString(36)}`;
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
    password: 'Passw0rd!ttl',
    options: { data: { username: USER } },
  });
  if (error) throw new Error(`signup: ${error.message}`);
  id = data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');

  const titleOf = async (cid) =>
    (await sql`select title from public.conversations where id = ${cid}`)[0].title;

  async function ask(conversationId, text) {
    const res = await fetch(`${APP}/api/chat`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        modelId,
        messages: [{ role: 'user', parts: [{ type: 'text', text }] }],
        maxOutputTokens: 16,
      }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`chat ${res.status}: ${body.slice(0, 120)}`);
    return res;
  }

  // Model catalogue — pick any enabled model.
  const cat = await (await fetch(`${APP}/api/models`, { headers: { cookie } })).json();
  const modelId = cat.models?.[0]?.id;
  check('catalogue reachable', Boolean(modelId), modelId);

  // 1. The client's placeholder must become the first prompt.
  const created = await (
    await fetch(`${APP}/api/conversations`, { method: 'POST', headers: { cookie } })
  ).json();
  const cid = created.id;
  check('new conversation starts as a placeholder', (await titleOf(cid)) === 'แชทใหม่');

  const firstPrompt = 'ช่วยแนะนำร้านกาแฟใกล้ฉัน';
  await ask(cid, firstPrompt);
  check(
    'placeholder is replaced by the first prompt',
    (await titleOf(cid)) === firstPrompt,
    `"${await titleOf(cid)}"`,
  );

  // 2. A later message must not re-title it.
  await ask(cid, 'แล้วอีกที่นึงล่ะ');
  check('a second message does not re-title', (await titleOf(cid)) === firstPrompt);

  // 3. A name the user chose must survive further messages.
  const patch = await fetch(`${APP}/api/conversations/${cid}`, {
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'ชื่อที่ผมตั้งเอง' }),
  });
  check('rename via PATCH works', patch.ok);

  await ask(cid, 'ครั้งนี้ข้อความยาวมากกว่าเดิม');
  check(
    'a user-chosen title is never overwritten',
    (await titleOf(cid)) === 'ชื่อที่ผมตั้งเอง',
    `"${await titleOf(cid)}"`,
  );

  // 4. Long first prompts are cut, not rejected.
  const created2 = await (
    await fetch(`${APP}/api/conversations`, { method: 'POST', headers: { cookie } })
  ).json();
  const long = 'x'.repeat(200);
  await ask(created2.id, long);
  const t = await titleOf(created2.id);
  check('a very long first line is truncated', t.length <= 61, `${t.length} chars`);
} catch (e) {
  check('run completed', false, e.message);
} finally {
  if (id) await sql`delete from auth.users where id = ${id}`;
  await sql.end();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);