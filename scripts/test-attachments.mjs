/**
 * Proves an uploaded attachment travels all the way to the model.
 *
 * OKMD is used explicitly: OpenRouter's free tier returns 429 once the day's
 * quota is gone, and this is about our plumbing, not about which provider is up.
 */
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

const BUCKET = 'chat-files';

const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP = process.env.APP_URL ?? 'http://localhost:3000';

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const results = [];
const check = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const USER = `att${Date.now().toString(36)}`;
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
    password: 'Passw0rd!att',
    options: { data: { username: USER } },
  });
  if (error) throw new Error(`signup: ${error.message}`);
  id = data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');

  const cat = await (await fetch(`${APP}/api/models`, { headers: { cookie } })).json();
  const model = (cat.models ?? []).find((m) => m.providerId && m.capabilities?.vision);
  check('a vision-capable model is available', Boolean(model), model?.label ?? 'none');

  const conversationId = (
    await (await fetch(`${APP}/api/conversations`, { method: 'POST', headers: { cookie } })).json()
  ).id;

  /* ── upload ─────────────────────────────────────────────────────────────── */
  // A 1x1 red PNG, so the test stays tiny and deterministic.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const form = new FormData();
  form.append('conversationId', conversationId);
  form.append('file', new Blob([png], { type: 'image/png' }), 'dot.png');

  const up = await fetch(`${APP}/api/attachments`, { method: 'POST', headers: { cookie }, body: form });
  const uploaded = await up.json();
  check('the image uploads', up.status === 201, uploaded.id);
  check('it is classified as an image', uploaded.kind === 'image', uploaded.kind);

  const linked = (
    await sql`select message_id from public.attachments where id = ${uploaded.id}`
  )[0];
  check('message_id is still null before sending', linked.message_id === null);

  /* ── send ───────────────────────────────────────────────────────────────── */
  const chat = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId,
      modelId: model.id,
      attachmentIds: [uploaded.id],
      messages: [{ role: 'user', parts: [{ type: 'text', text: 'รูปนี้เป็นสีอะไร' }] }],
      maxOutputTokens: 64,
    }),
  });
  const sse = await chat.text();
  check('the chat streams', chat.status === 200, `status=${chat.status}`);

  /* ── the attachment is now attached ─────────────────────────────────────── */
  const after = (
    await sql`select message_id from public.attachments where id = ${uploaded.id}`
  )[0];
  check('the upload is linked to the user message', Boolean(after.message_id), after.message_id ?? 'still null');

  const parts = (
    await sql`select parts from public.messages where id = ${after.message_id}`
  )[0].parts;
  const ref = (Array.isArray(parts) ? parts : []).find((p) => p?.type === 'file');
  check('the message stores the attachment for history', Boolean(ref), ref ? `${ref.name} (${ref.kind})` : 'no file part');
  check('the stored reference carries no bytes', !JSON.stringify(parts).includes('iVBOR'), 'metadata only');

  const said = sse.match(/"text":"([^"]+)"/g)?.map((m) => m.slice(8, -1)).join('') ?? '';

  // Before blaming this code for an empty stream, find out whether *any* model
  // is answering right now. OpenRouter's free tier returns 429 once the day's
  // quota is spent, which looks exactly like a bug and is not one.
  let anythingAnswers = said.trim().length > 0;
  if (!anythingAnswers) {
    const probe = await fetch(`${APP}/api/chat`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        modelId: model.id,
        messages: [{ role: 'user', parts: [{ type: 'text', text: 'Say OK' }] }],
        maxOutputTokens: 16,
      }),
    });
    const probeText = await probe.text();
    anythingAnswers = /"text":"[^"]+"/.test(probeText);
  }

  if (!anythingAnswers) {
    console.log('⏭  the model did not answer — every provider is refusing right now');
    console.log('   (OpenRouter free returns 429 once the daily quota is gone;');
    console.log('    OKMD exposes no capability metadata, so nothing here reports vision)');
    console.log('   skipping the two "the model saw the image" checks');
  } else {
    check('the model answered at all', said.trim().length > 0, said.slice(0, 90) || '(no text)');
    check(
      'the answer is about the colour, so it saw the image',
      /แดง|red/i.test(said),
      said.slice(0, 90),
    );
  }

  /* ── read back through the new endpoint ─────────────────────────────────── */
  const file = await fetch(`${APP}/api/attachments/${uploaded.id}`, { headers: { cookie } });
  const bytes = Buffer.from(await file.arrayBuffer());
  check('the file can be fetched back for history', file.status === 200 && bytes.length === png.length, `${bytes.length} bytes`);
  check('it comes back with its own content type', file.headers.get('content-type') === 'image/png', file.headers.get('content-type') ?? '');

  const anon = await fetch(`${APP}/api/attachments/${uploaded.id}`);
  check('someone signed out cannot read it', anon.status === 401, `status=${anon.status}`);

  /* ── deleting the conversation takes the bytes with it ──────────────────── */
  const row = (
    await sql`select storage_path from public.attachments where id = ${uploaded.id}`
  )[0];
  const del = await fetch(`${APP}/api/conversations/${conversationId}`, { method: 'DELETE', headers: { cookie } });
  check('the conversation deletes', del.ok);

  await new Promise((r) => setTimeout(r, 600));
  const { data: gone, error: listErr } = await createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  ).storage.from(BUCKET).list(row.storage_path.split('/').slice(0, 2).join('/'));
  const stillThere = (gone ?? []).some((f) => f.name === row.storage_path.split('/').pop());
  check('the stored file is gone too, not orphaned', !stillThere, listErr?.message ?? '');
} catch (e) {
  check('run completed', false, e.message);
} finally {
  if (id) await sql`delete from auth.users where id = ${id}`;
  await sql.end();
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);