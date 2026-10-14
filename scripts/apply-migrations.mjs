/**
 * Apply `drizzle/*.sql` in journal order, recording each one so a re-run skips it.
 *
 *   npm run db:migrate
 *
 * Why this exists instead of `drizzle-kit migrate`: that command opens its own
 * connection and runs each batch inside a transaction, which the Supabase
 * *transaction pooler* (port 6543 — the URL in `.env.local`) silently drops. It
 * prints a spinner, reports success, applies nothing, and records nothing, so a
 * schema change looks deployed while the database never moved. It had already
 * lost one migration (0004, two indexes) before this file existed.
 *
 * This uses the same `postgres` driver as every other script here, which the
 * pooler serves correctly, and it records progress in the same
 * `drizzle.__drizzle_migrations` table using the same sha256-of-file-contents
 * key. Switching back to `drizzle-kit migrate` stays safe: it will find these
 * hashes recorded and skip straight past them.
 *
 * Statements are split on drizzle's `--> statement-breakpoint` marker and run
 * one at a time so a failure names the statement that broke. Errors that mean
 * "already there" are swallowed on purpose, so re-running a partially applied
 * file converges instead of aborting on its own first statement.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';

const DIR = 'drizzle';
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

/**
 * Errors that mean the statement's goal is already met. A migration is a
 * description of a target state, not a script that must run exactly once.
 */
const ALREADY_DONE = [
  'already exists',
  'already has',
  'duplicate key value',
  'duplicate_object',
  'duplicate_table',
  'duplicate_column',
  'duplicate_function',
];

/** Migrations this repo owns, in the order they must be applied. */
function journal() {
  const { entries } = JSON.parse(readFileSync(join(DIR, 'meta/_journal.json'), 'utf8'));
  return entries
    .map((e) => e.tag)
    .filter((tag) => readdirSync(DIR).includes(`${tag}.sql`));
}

const applied = new Set(
  (await sql`select hash from drizzle.__drizzle_migrations`).map((r) => r.hash),
);

let ran = 0;
let skipped = 0;

for (const tag of journal()) {
  const body = readFileSync(join(DIR, `${tag}.sql`), 'utf8');
  const hash = createHash('sha256').update(body).digest('hex');

  if (applied.has(hash)) {
    skipped++;
    continue;
  }

  const statements = body
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);

  let done = 0;
  for (const statement of statements) {
    try {
      await sql.unsafe(statement);
      done++;
    } catch (err) {
      const message = String(err?.message ?? err);
      if (ALREADY_DONE.some((m) => message.includes(m))) continue;
      console.error(`\n✗ ${tag} failed on statement ${done + 1} of ${statements.length}:`);
      console.error(`  ${message}`);
      console.error(`  ${statement.split('\n').slice(0, 3).join('\n  ')}\n`);
      await sql.end();
      process.exit(1);
    }
  }

  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${Date.now()})`;
  ran++;
  console.log(`✓ ${tag} — ${done} statement(s)`);
}

console.log(
  ran ? `\napplied ${ran} migration(s), ${skipped} already current` : `nothing to do — ${skipped} migration(s) already applied`,
);

await sql.end();