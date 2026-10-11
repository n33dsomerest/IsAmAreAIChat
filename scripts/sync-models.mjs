/**
 * Seed the providers this deployment talks to, then pull each catalogue into
 * `provider_models`.
 *
 *   npm run admin:sync-models                  # per-provider defaults below
 *   npm run admin:sync-models -- --mode=all    # override every provider
 *   npm run admin:sync-models -- --okmd=none   # override one provider
 *
 * Idempotent: existing rows are matched by `name` and updated in place, so it is
 * safe to re-run after changing a base URL or an env var name.
 *
 * Ordering is the fallback chain. `sortOrder` on the provider decides who gets
 * tried first, so the free provider comes before the paid backup.
 */
import postgres from 'postgres';

const SQL = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

/**
 * What to enable after discovering the catalogue.
 *
 *   free   only `:free` model ids
 *   all    everything the provider listed
 *   none   discover only, enable nothing
 *
 * Kept per provider because the two are genuinely different: OpenRouter exposes
 * 458 models of which 16 are free, while OKMD is a university gateway where
 * every model is usable, so all of them are enabled.
 */
const MODES = new Set(['free', 'all', 'none']);

const PROVIDERS = [
  {
    name: 'openrouter',
    display: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    envKeyName: 'OPENROUTER_API_KEY',
    sortOrder: 1,
    mode: 'free',
  },
  {
    name: 'okmd',
    display: 'OKMD (KKU IntelSphere)',
    kind: 'openai-compatible',
    baseUrl: 'https://gen.ai.kku.ac.th/okmd/api/v1',
    envKeyName: 'OKMD_API_KEY',
    sortOrder: 2,
    mode: 'all',
  },
];

/** `--mode=x` sets the default, `--<slug>=x` overrides a single provider. */
const overrides = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, '').split('=');
  if (value && MODES.has(value)) overrides.set(key === 'mode' ? '*' : key, value);
}
if (process.argv.includes('--all')) overrides.set('*', 'all');
if (process.argv.includes('--none')) overrides.set('*', 'none');

function modeFor(provider) {
  return overrides.get(provider.name) ?? overrides.get('*') ?? provider.mode;
}

/** Minimal port of src/lib/ai/sync-models.ts — this script runs outside Next. */
import { curatedLabel, hasKnownVision, isCuratedOpenRouter } from '../src/lib/ai/model-curation.ts';

function num(v) {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

const isFree = (id) => id.endsWith(':free') || id === 'openrouter/free';

/**
 * Mirrors `defaultEnabled` in src/lib/ai/model-visibility.ts. OpenRouter is
 * curated to a chosen few; other providers fall back to "everything free".
 */
function defaultEnabled(providerName, remoteModelId) {
  if (providerName === 'openrouter') return isCuratedOpenRouter(remoteModelId);
  return isFree(remoteModelId);
}

/**
 * A presentable name for a model id, used only when the gateway supplies none.
 * Kept in step with humanize() in src/lib/ai/sync-models.ts.
 */
function humanize(id) {
  const slug = String(id).split('/').pop() ?? id;
  return slug.replace(/:free$/i, '').replace(/[-_]+/g, ' ').trim() || id;
}

function normalize(raw, providerName) {
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
  const measuredVision = hasKnownVision(providerName, id);

  return {
    remoteModelId: id,
    displayName: curatedLabel(id, typeof raw.name === 'string' && raw.name ? raw.name : humanize(id)),
    contextWindow: num(raw.context_length) ?? num(raw.context_window),
    maxOutput: num(raw.max_tokens) ?? num(raw.top_provider?.max_completion_tokens),
    capabilities: {
      vision: modalities.includes('image') || measuredVision,
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

async function sync(providerId, provider) {
  const { baseUrl, envKeyName, display: label } = provider;
  const mode = modeFor(provider);
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
    remote = list.map((m) => normalize(m, provider.name.toLowerCase())).filter(Boolean);
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
    const enabled =
      mode === 'all' ? true : mode === 'none' ? false : defaultEnabled(provider.name, m.remoteModelId);

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
  // Counted from the same rule that wrote the rows, so the summary cannot
  // report a different number than the one the loop actually applied.
  const enabledCount =
    mode === 'none'
      ? 0
      : mode === 'all'
        ? remote.length
        : remote.filter((m) => defaultEnabled(provider.name, m.remoteModelId)).length;
  console.log(
    `  ✓ ${label}: discovered ${remote.length} (${freeCount} free) · mode=${mode} → enabled ${enabledCount}` +
      ` · +${inserted} new, ${updated} updated, ${gone.length} disabled`,
  );
}

try {
  for (const p of PROVIDERS) {
    const id = await upsertProvider(p);
    console.log(`\n▸ ${p.display}  (${p.baseUrl})`);
    await sync(id, p);
  }

  const summary = await SQL`
    select p.name, p.sort_order,
           count(*) filter (where pm.enabled) as enabled,
           count(*) filter (where pm.enabled and not pm.is_fallback) as primary
      from public.providers p
      left join public.provider_models pm on pm.provider_id = p.id
     group by p.name, p.sort_order
     order by p.sort_order
  `;
  console.log('\n── catalogue ──');
  for (const r of summary) {
    console.log(`  ${r.name.padEnd(14)} enabled=${r.enabled}  primary=${r.primary}`);
  }
} finally {
  await SQL.end();
}