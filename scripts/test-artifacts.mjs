/**
 * Phase 8 — artifacts.
 *
 *   npm run test:artifacts
 *
 * The fence splitter is a pure function, so it is checked directly as well as
 * through a real turn. The stored message is inspected to confirm the artifact
 * ended up as its own row rather than inline prose.
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
const USER = `ar${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!ar';

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

/** Mirrors src/lib/chat/artifacts.ts — kept local so the test runs without Next. */
function extractArtifacts(text) {
  const FENCE =
    /^```artifact(?:\s+lang=([\w+-]+))?(?:\s+title="([^"]{0,120})")?\s*\n([\s\S]*?)^```\s*$/gm;
  const segments = [];
  let cursor = 0;
  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(text); m; m = FENCE.exec(text)) {
    const before = text.slice(cursor, m.index);
    if (before.trim()) segments.push({ type: 'text', text: before });
    segments.push({
      type: 'artifact',
      artifact: { title: m[2] ?? null, language: (m[1] ?? 'text').toLowerCase(), source: m[3].trimEnd() },
    });
    cursor = m.index + m[0].length;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) segments.push({ type: 'text', text: tail });
  return segments;
}

try {
  /* Pure parsing, no server needed --------------------------------------- */
  const parsed = extractArtifacts(
    'ก่อนหน้านี้\n```artifact lang=html title="ทดสอบ"\n<h1>hi</h1>\n```\nและหลังจากนี้\n',
  );
  check('prose before the fence is kept', parsed[0]?.type === 'text' && parsed[0].text.includes('ก่อนหน้านี้'));
  check('the fence becomes an artifact', parsed[1]?.type === 'artifact', parsed[1]?.artifact?.language ?? '');
  check('the title is read', parsed[1]?.artifact?.title === 'ทดสอบ', parsed[1]?.artifact?.title ?? '');
  check('the source is captured', parsed[1]?.artifact?.source === '<h1>hi</h1>');
  check('prose after the fence is kept', parsed[2]?.type === 'text' && parsed[2].text.includes('หลังจากนี้'));

  const noFence = extractArtifacts('```js\nconsole.log(1)\n```');
  check('a plain code fence stays inline', noFence.length === 1 && noFence[0].type === 'text');

  const two = extractArtifacts(
    '```artifact lang=svg\n<svg/>\n```\nและ\n```artifact lang=html\n<p/>\n```',
  );
  check(
    'two artifacts are separated',
    two.filter((s) => s.type === 'artifact').length === 2,
    `${two.filter((s) => s.type === 'artifact').length}`,
  );

  /* End to end ------------------------------------------------------------ */
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

  const { models } = await (await fetch(`${APP}/api/models`, { headers: { cookie } })).json();

  const chat = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: models[0].id,
      artifacts: true,
      messages: [
        {
          role: 'user',
          parts: [
            {
              type: 'text',
              text: 'สร้างหน้าเว็บ HTML ง่ายๆ ให้หนึ่งหน้า ใช้ create_artifact ภาษา html',
            },
          ],
        },
      ],
      maxOutputTokens: 2048,
    }),
  });

  let artifactEvents = [];
  let text = '';
  let reasoning = 0;
  if (chat.body) {
    const reader = chat.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const line of decoder.decode(value, { stream: true }).split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
        const e = JSON.parse(line.slice(6));
        if (e.type === 'text-delta') text += e.text;
        if (e.type === 'reasoning-delta') reasoning += (e.text ?? '').length;
        if (e.type === 'artifact') artifactEvents.push(e.artifact);
      }
    }
  }

  check('the chat streams', chat.status === 200, `status=${chat.status}`);
  check(
    'an artifact was produced',
    artifactEvents.length > 0,
    `${artifactEvents.length} artifacts, text=${text.length} reasoning=${reasoning}`,
  );
  check(
    'the artifact carries a language',
    artifactEvents[0]?.language === 'html',
    artifactEvents[0]?.language ?? '',
  );
  check(
    'the artifact carries source',
    (artifactEvents[0]?.source?.length ?? 0) > 20,
    `${artifactEvents[0]?.source?.length ?? 0} bytes`,
  );

  /* It is stored, and listable ------------------------------------------- */
  const conversationId = chat.headers.get('x-conversation-id');
  const stored = await sql`
    select a.language, a.source, a.title
      from public.artifacts a
      join public.messages m on m.id = a.message_id
     where m.conversation_id = ${conversationId}`;
  check('it is stored as its own row', stored.length > 0, `${stored.length} rows`);
  check(
    'the stored language matches',
    stored[0]?.language === artifactEvents[0]?.language,
    `${stored[0]?.language}`,
  );

  const parts = await sql`
    select parts from public.messages
     where conversation_id = ${conversationId} and role = 'assistant'`;
  const storedParts = parts[0]?.parts ?? [];
  check(
    'the message stores an artifact part',
    storedParts.some((p) => p?.type === 'artifact'),
    `${storedParts.length} parts`,
  );

  const list = await fetch(`${APP}/api/artifacts`, { headers: { cookie } });
  const listData = await list.json().catch(() => ({}));
  check('the gallery lists it', listData.artifacts?.some((a) => a.language === 'html'), `${listData.artifacts?.length ?? 0} artifacts`);

  const anon = await fetch(`${APP}/api/artifacts`);
  check('the gallery is private', anon.status === 401, `status=${anon.status}`);
} catch (err) {
  check('artifact run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);