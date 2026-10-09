/**
 * Seed the providers this deployment talks to, then pull each catalogue into
 * `provider_models`.
 *
 *   npm run admin:sync-models
 *
 * Idempotent: existing rows are matched by `name` and updated in place, so it is
 * safe to re-run after changing a base URL or an env var name.
 *
 * Ordering is the fallback chain. `sortOrder` on the provider decides who gets
 * tried first, so the free provider comes before the paid backup. Within a
 * provider, `:free` model ids are classified as non-fallback automatically.
 */
import postgres from 'postgres';

const SQL = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

/**
 * What to enable after discovering the catalogue.
 *
 *   (default)    only `:free` models — 458 paid models in the picker is
 *                unusable, and auto-flagging them as fallbacks buries the
 *                other providers at the very end of a 400-long chain
 *   --all        enable everything (useful when curating by hand)
 *   --none       discover only, enable nothing
 *
 * Idempotent: existing rows are matched by remote_model_id and updated in place.
 */
const MODE = process.argv.includes('--all')
  ? 'all'
  : process.argv.includes('--none')
    ? 'none'
    : 'free';

const PROVIDERS = [
  {
    name: 'openrouter',
    display: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKeyName: 'OPENROUTER_API_KEY',
    sortOrder: 1,
  },
  {
    name: 'okmd',
    display: 'OKMD (KKU IntelSphere)',
    kind: 'openai-compatible',
    baseUrl: 'https://gen.ai.kku.ac.th/okmd/api/v1',
    envKeyName: 'OKMD_API_KEY',
    sortOrder: 2,
  },
];

/** Minimal port of src/lib/ai/sync-models.ts — this script runs outside Next. */
function num(v) {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

const isFree = (id) => id.endsWith(':free') || id === 'openrouter/free';

function normalize(raw) {
  const id = typeof raw.id === 'string' ? raw.id : null;
  if (!id) return null;

  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const modalities = Array.isArray(raw.architecture?.input_modalities)
    ? raw.architecture.input_modalities
    : [];
  const p = raw.pricing ?? {};
  const perM = (v) => {
    const n = num(v);
    return n === null ? undefined : Math.round(n * 1_000_000 * 1e6) / 1e6;
  };

  return {
    remoteModelId: id,
    displayName: typeof raw.name === 'string' && raw.name ? raw.name : id,
    contextWindow: num(raw.context_length) ?? num(raw.context_window),
    maxOutput: num(raw.max_tokens) ?? num(raw.top_provider?.max_completion_tokens),
    capabilities: {
      vision: modalities.includes('image'),
      tools: params.includes('tools') || params.includes('tool_choice'),
      reasoning: params.includes('reasoning') || params.includes('include_reasoning'),
      json: params.includes('response_format') || params.includes('structured_outputs'),
      pdf: modalities.includes('file'),
    },
    pricing: {
      input: perM(p.prompt ?? p.input),
      output: perM(p.completion ?? p.output),
      cacheRead: perM(p.input_cache_read),
      cacheWrite: perM(p.input_cache_write),
      currency: 'USD',
    },
  };
}

async function upsertProvider(p) {
  const [existing] = await SQL`select id from public.providers where name = ${p.name}`;
  if (existing) {
    await SQL`
      update public.providers
         set kind = ${p.kind}, base_url = ${p.baseUrl},
             env_key_name = ${p.envKeyName}, enabled = true, sort_order = ${p.sortOrder}
       where id = ${existing.id}
    `;
    return existing.id;
  }
  const [row] = await SQL`
    insert into public.providers (name, kind, base_url, env_key_name, enabled, sort_order)
    values (${p.name}, ${p.kind}, ${p.baseUrl}, ${p.envKeyName}, true, ${p.sortOrder})
    returning id
  `;
  return row.id;
}

async function sync(providerId, baseUrl, envKeyName, label) {
  const apiKey = process.env[envKeyName];
  if (!apiKey) {
    console.log(`  ✗ ${label}: ${envKeyName} is not set — skipping`);
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let remote;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.log(`  ✗ ${label}: ${res.status} ${body.slice(0, 120)}`);
      return;
    }
    const json = await res.json();
    const list = Array.isArray(json) ? json : (json?.data ?? json?.models ?? []);
    remote = list.map(normalize).filter(Boolean);
  } catch (err) {
    console.log(`  ✗ ${label}: ${err.name === 'AbortError' ? 'timed out' : err.message}`);
    return;
  } finally {
    clearTimeout(timer);
  }

  const existing = await SQL`select id, remote_model_id, sort_order, is_fallback, enabled from public.provider_models where provider_id = ${providerId}`;
  const byRemote = new Map(existing.map((m) => [m.remote_model_id, m]));

  let inserted = 0;
  let updated = 0;
  let order = 0;
  const seen = new Set();

  for (const m of remote) {
    seen.add(m.remoteModelId);
    const prev = byRemote.get(m.remoteModelId);
    const free = isFree(m.remoteModelId);
    const enabled = MODE === 'all' ? true : MODE === 'none' ? false : free;

    if (prev) {
      await SQL`
        update public.provider_models
           set display_name = ${m.displayName}, context_window = ${m.contextWindow},
               max_output = ${m.maxOutput},
               capabilities = ${SQL.json(m.capabilities)}, pricing = ${SQL.json(m.pricing)},
               enabled = ${enabled}
         where id = ${prev.id}
      `;
      updated++;
    } else {
      await SQL`
        insert into public.provider_models
          (provider_id, remote_model_id, display_name, context_window, max_output,
           capabilities, pricing, enabled, is_fallback, sort_order, last_synced_at)
        values (${providerId}, ${m.remoteModelId}, ${m.displayName}, ${m.contextWindow},
                ${m.maxOutput}, ${SQL.json(m.capabilities)}, ${SQL.json(m.pricing)}, ${enabled},
                false, ${order}, now())
      `;
      inserted++;
    }
    order++;
  }

  const gone = existing.filter((m) => !seen.has(m.remote_model_id));
  for (const m of gone) {
    await SQL`update public.provider_models set enabled = false where id = ${m.id}`;
  }

  const freeCount = remote.filter((m) => isFree(m.remoteModelId)).length;
  const enabledCount = MODE === 'none' ? 0 : MODE === 'all' ? remote.length : freeCount;
  console.log(
    `  ✓ ${label}: discovered ${remote.length} (${freeCount} free) · enabled ${enabledCount}` +
      ` · +${inserted} new, ${updated} updated, ${gone.length} disabled`,
  );
}

try {
  for (const p of PROVIDERS) {
    const id = await upsertProvider(p);
    console.log(`\n▸ ${p.display}  (${p.baseUrl})`);
    await sync(id, p.baseUrl, p.envKeyName, p.display);
  }

  const summary = await SQL`
    select p.name, p.sort_order,
           count(*) filter (where pm.enabled) as enabled,
           count(*) filter (where pm.enabled and not pm.is_fallback) as free_models
      from public.providers p
      left join public.provider_models pm on pm.provider_id = p.id
     group by p.name, p.sort_order
     order by p.sort_order
  `;
  console.log('\n── catalogue ──');
  for (const r of summary) {
    console.log(`  ${r.name.padEnd(14)} enabled=${r.enabled}  free=${r.free_models}`);
  }
} finally {
  await SQL.end();
}