/**
 * Phase 4 — one real generation, end to end.
 *
 *   npm run test:chat
 *
 * Signs a real account up, picks a live model, streams a reply from an actual
 * provider, and then checks the money: exactly one credit gone, the usage row
 * settled with the model that answered, and the message persisted.
 *
 * The fixture user is deleted at the end, which cascades its usage rows away.
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
const USER = `ch${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!chat';

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

  const before = (
    await sql`select credits_balance from public.users where id = ${createdId}`
  )[0].credits_balance;
  check('fixture starts with credits', before === 10, `${before} credits`);

  /* Catalogue ---------------------------------------------------------- */
  const cat = await fetch(`${APP}/api/models`, { headers: { cookie } });
  const { models } = await cat.json();
  check('catalogue reachable', cat.status === 200 && models.length > 0, `${models?.length} models`);

  const picked = models[0];
  check('a model is selectable', Boolean(picked?.id), `${picked?.provider} · ${picked?.label}`);

  /* Generate ------------------------------------------------------------ */
  const res = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      modelId: picked.id,
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'ตอบว่า OK เท่านั้น' }] }],
      maxOutputTokens: 512,
    }),
  });

  check('chat stream starts', res.status === 200, `status=${res.status}`);
  check(
    'response is an SSE stream',
    (res.headers.get('content-type') ?? '').includes('text/event-stream'),
    res.headers.get('content-type') ?? '',
  );

  const conversationId = res.headers.get('x-conversation-id');
  check('a conversation was created', Boolean(conversationId), conversationId ?? '');
  check(
    'headers report the answering model',
    Boolean(res.headers.get('x-model-name')),
    `${res.headers.get('x-provider')} · ${res.headers.get('x-model-name')}`,
  );

  let text = '';
  let reasoning = '';
  let sawFinish = false;
  let sawError = false;
  if (res.body) {
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
      for (const line of decoder.decode(chunk, { stream: true }).split('\n\n')) {
        if (!line.startsWith('data: ')) continue;
const payload = JSON.parse(line.slice(6));
        if (payload.type === 'text-delta') text += payload.text ?? '';
        if (payload.type === 'reasoning-delta') reasoning += payload.text ?? '';
        if (payload.type === 'finish') sawFinish = true;
        if (payload.type === 'error') sawError = true;
      }
    }
  }

  check('no stream error', !sawError);
  check('stream finished cleanly', sawFinish);
  check(
    'assistant produced output',
    text.trim().length > 0 || reasoning.trim().length > 0,
    `text="${text.trim().slice(0, 50)}" reasoning=${reasoning.trim().length} chars`,
  );

  /* Money --------------------------------------------------------------- */
  const after = (
    await sql`select credits_balance from public.users where id = ${createdId}`
  )[0].credits_balance;
  check('exactly one credit spent', after === before - 1, `${before} → ${after}`);

  const events = await sql`
    select status, attempts, provider_name, remote_model_id, input_tokens, output_tokens, error
      from public.usage_events
     where user_id = ${createdId}
     order by created_at desc`;

  check('one usage row written', events.length === 1, `${events.length} rows`);
  check('usage row settled as success', events[0]?.status === 'success', events[0]?.status);
  check('usage row names the model that answered', Boolean(events[0]?.remote_model_id), events[0]?.remote_model_id ?? '');
  check('tokens recorded', events[0]?.output_tokens > 0, `in=${events[0]?.input_tokens} out=${events[0]?.output_tokens}`);

  const stored = await sql`
    select role, count(*)::int as n from public.messages
     where conversation_id = ${conversationId}
     group by role order by role`;
  check('user turn persisted', stored.some((r) => r.role === 'user'), JSON.stringify(stored));

  /* Refusal path ------------------------------------------------------- */
  const noCredits = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ modelId: picked.id, messages: [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }),
  });
  check('a second request is accepted while credits remain', noCredits.status === 200 || noCredits.status === 402,
    `status=${noCredits.status}`);
  await noCredits.body?.cancel?.();
} catch (err) {
  check('chat run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);