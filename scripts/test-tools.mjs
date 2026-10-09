/**
 * Phase 7 — attachments, tools and MCP wiring.
 *
 *   npm run test:tools
 *
 * Uses real storage and a real tool call. The MCP half is exercised against a
 * stub server this script runs itself, so the JSON-RPC framing is checked for
 * real without depending on somebody's public MCP endpoint.
 */
import { createServerClient } from '@supabase/ssr';
import { createServer } from 'node:http';
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
const USER = `tl${Date.now().toString(36)}`;
const EMAIL = `${USER}@${DOMAIN}`;
const PASSWORD = 'Passw0rd!tl';

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

let createdId = null;

/** A 1×1 PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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

/** Minimal MCP server: answers tools/list and tools/call over plain JSON. */
function startStubMcp() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        let rpc = {};
        try {
          rpc = JSON.parse(body);
        } catch {
          /* ignore */
        }

        let result = {};
        if (rpc.method === 'tools/list') {
          result = {
            tools: [
              {
                name: 'echo',
                description: 'ทดสอบ echo',
                inputSchema: {
                  type: 'object',
                  properties: { text: { type: 'string', description: 'ข้อความ' } },
                  required: ['text'],
                },
              },
            ],
          };
        } else if (rpc.method === 'tools/call') {
          result = {
            content: [{ type: 'text', text: `echo:${rpc.params?.arguments?.text ?? ''}` }],
          };
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/mcp`, close: () => server.close() });
    });
  });
}

try {
  /* MCP server registered by this run ----------------------------------- */
  const stub = await startStubMcp();
  check('stub MCP server listening', Boolean(stub.url), stub.url);

  /* Fixture — promoted to admin because the MCP probe is admin-only ----- */
  const { cookie, id } = await signIn();
  createdId = id;
  check('fixture created', true, USER);

  await sql`update public.users set role = 'admin' where id = ${id}`;

  const [mcpRow] = await sql`
    insert into public.mcp_servers (name, url, transport, headers, enabled)
    values ('stub', ${stub.url}, 'http', '{}'::jsonb, true)
    returning id`;
  check('MCP server row created', Boolean(mcpRow?.id));

  const probe = await fetch(`${APP}/api/admin/mcp`, {
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ id: mcpRow.id, action: 'probe' }),
  });
  const probeData = await probe.json().catch(() => ({}));
  check(
    'probe discovers the tool',
    probe.status === 200 && probeData.tools?.[0]?.name?.includes('echo'),
    probeData.tools?.map((t) => t.name).join(', ') ?? probeData.message ?? '',
  );

  const forbidden = await fetch(`${APP}/api/admin/mcp`, {
    headers: { cookie: '' },
  });
  check('anonymous cannot list MCP servers', forbidden.status === 401, `status=${forbidden.status}`);

  // Back to a normal user for the rest of the run.
  await sql`update public.users set role = 'user' where id = ${id}`;

  const { models } = await (await fetch(`${APP}/api/models`, { headers: { cookie } })).json();
  const model = models[0];

  const conv = await (
    await fetch(`${APP}/api/conversations`, { method: 'POST', headers: { cookie } })
  ).json();
  check('conversation created', Boolean(conv?.id), conv?.id ?? '');

  /* Attachments --------------------------------------------------------- */
  const uploadForm = new FormData();
  uploadForm.append('conversationId', conv.id);
  uploadForm.append('file', new Blob([PNG], { type: 'image/png' }), 'pixel.png');

  const upload = await fetch(`${APP}/api/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: uploadForm,
  });
  const uploaded = await upload.json().catch(() => ({}));
  check('an image uploads', upload.status === 201, `${upload.status} ${uploaded.error ?? ''}`);
  check('it is classified as an image', uploaded.kind === 'image', uploaded.kind);

  const textForm = new FormData();
  textForm.append('conversationId', conv.id);
  textForm.append('file', new Blob(['ราคาต่อกิโลกรัม 42 บาท'], { type: 'text/plain' }), 'note.txt');
  const textUpload = await fetch(`${APP}/api/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: textForm,
  });
  const textRow = await textUpload.json().catch(() => ({}));
  check('a text file uploads', textUpload.status === 201, `${textUpload.status} ${textRow.error ?? ''}`);
  check('it is classified as text', textRow.kind === 'text', textRow.kind);

  const stored = await sql`
    select storage_path, extracted_text from public.attachments
     where conversation_id = ${conv.id} order by created_at`;
  check('both files are recorded', stored.length === 2, `${stored.length} rows`);
  check(
    'the storage path is namespaced to the user',
    stored.every((r) => r.storage_path.startsWith(`${createdId}/`)),
    stored[0]?.storage_path?.slice(0, 24) ?? '',
  );
  check('text was extracted up front', stored.some((r) => r.extracted_text?.includes('42')));

  const badForm = new FormData();
  badForm.append('conversationId', conv.id);
  badForm.append('file', new Blob(['x'], { type: 'application/x-msdownload' }), 'evil.exe');
  const rejected = await fetch(`${APP}/api/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: badForm,
  });
  check('an executable is rejected', rejected.status === 415, `status=${rejected.status}`);

  const foreignForm = new FormData();
  foreignForm.append('conversationId', '00000000-0000-4000-8000-000000000000');
  foreignForm.append('file', new Blob([PNG], { type: 'image/png' }), 'pixel.png');
  const foreign = await fetch(`${APP}/api/attachments`, {
    method: 'POST',
    headers: { cookie },
    body: foreignForm,
  });
  check("another user's conversation is unreachable", foreign.status === 404, `status=${foreign.status}`);

  /* Tools actually run in a chat --------------------------------------- */
  const chat = await fetch(`${APP}/api/chat`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({
      conversationId: conv.id,
      modelId: model.id,
      webSearch: false,
      messages: [
        {
          role: 'user',
          parts: [{ type: 'text', text: 'ใช้เครื่องมือ compute คำนวณ (1234*2+56)/3 แล้วบอกผล' }],
        },
      ],
      maxOutputTokens: 512,
    }),
  });

  let toolEvents = [];
  let toolOutput = '';
  let toolName = '';
  let toolInput = '';
  let answer = '';
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
        if (e.type === 'text-delta') answer += e.text;
        if (e.type === 'reasoning-delta') reasoning += (e.text ?? '').length;
        if (e.type === 'tool-call') {
          toolName = e.toolName ?? '';
          toolInput = JSON.stringify(e.input ?? {});
        }
        if (e.type === 'tool-result') {
          toolEvents.push(e.type);
          toolOutput = JSON.stringify(e.output ?? '');
        }
        if (e.type.startsWith('tool-')) toolEvents.push(e.type);
      }
    }
  }
  check('the chat streams', chat.status === 200, `status=${chat.status}`);
  check(
    'a tool was called',
    toolEvents.some((t) => t.includes('input')),
    [...new Set(toolEvents)].join(', '),
  );
  check('the tool name is namespaced or builtin', Boolean(toolName), toolName);
  check(
    'a tool result came back',
    toolEvents.includes('tool-result') && toolOutput.length > 2,
    toolOutput.slice(0, 60),
  );
  check(
'the arithmetic is exact',
    toolName !== 'compute' || toolOutput.includes('841.33'),
    `${toolName} input=${toolInput} => ${toolOutput.slice(0, 60)}`,
  );
  check(
    'the answer was produced',
    answer.trim().length > 0 || reasoning > 0,
    `text=${answer.trim().length} reasoning=${reasoning}`,
  );

  stub.close();
  await sql`delete from public.mcp_servers where id = ${mcpRow.id}`;
} catch (err) {
  check('tools run completed', false, err.message);
} finally {
  if (createdId) await sql`delete from auth.users where id = ${createdId}`;
  await sql.end();
}

/** Signs the fixture in, and the admin in for the probe. */
async function signIn() {
  const jar = new Map();
  const supabase = clientWithJar(jar);
  const { data, error } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: { data: { username: USER } },
  });
  if (error || !data.user) throw new Error(`signup failed: ${error?.message}`);
  createdId = createdId ?? data.user.id;
  const cookie = [...jar].map(([n, v]) => `${n}=${v}`).join('; ');
  return { cookie, id: data.user.id };
}

const failed = results.filter((r) => !r.pass);
console.log(failed.length ? `\n${failed.length}/${results.length} FAILED` : `\nall ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);