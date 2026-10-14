/**
 * Secret leak check.
 *
 *   node scripts/check-secrets.mjs
 *
 * Reads the real values from the local env, then greps the entire git history
 * for them. It prints only *where* a value was found — never the value itself,
 * because this script's output lands in a transcript too.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const SUSPECT = [
  'DATABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'TOKENHARBOR_API_KEY',
  'OKMD_API_KEY',
  'SLIPOK_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'CRON_SECRET',
];

/** Values are quoted or percent-encoded in some parsers; try both forms. */
function variants(value) {
  const out = new Set([value]);
  const unquoted = value.replace(/^["']|["']$/g, '');
  out.add(unquoted);
  out.add(unquoted.replace(/\$/g, '%24'));
  return [...out].filter((v) => v.length >= 8);
}

function loadEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.local') };

// Anything short is not a secret worth searching for.
const tracked = SUSPECT.filter((key) => (env[key] ?? '').length >= 8);

if (!tracked.length) {
  console.log('no secrets configured locally — nothing to check');
  process.exit(0);
}

let patches;
try {
  patches = execFileSync('git', ['log', '-p', '--all'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
  });
} catch {
  console.log('no git history to scan');
  process.exit(0);
}

let leaked = 0;
for (const key of tracked) {
  const hits = variants(env[key]).filter((v) => patches.includes(v)).length;
  if (hits) {
    leaked++;
    console.log(`✗ ${key} — its value appears in git history`);
  } else {
    console.log(`✓ ${key} — not present in history`);
  }
}

console.log(
  leaked
    ? `\n${leaked} secret(s) reached the history. Rotate them and rewrite the history:\n` +
        '  git filter-repo --invert-paths --path .env --path .env.local\n' +
        '  git push --force --all'
    : '\nno secret values are in the git history',
);

process.exit(leaked ? 1 : 0);