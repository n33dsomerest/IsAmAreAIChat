/**
 * Names conversations that never got a title.
 *
 *   npm run db:titles -- --dry-run
 *   npm run db:titles
 *
 * The client creates a conversation before its first message exists, so every
 * chat used to be titled "แชทใหม่" for good. /api/chat now fixes that as it
 * goes; this repairs the ones that already exist.
 *
 * Only rows still holding a placeholder are touched — a title the user typed is
 * never overwritten.
 */
import postgres from 'postgres';

const dryRun = process.argv.includes('--dry-run');
const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

const PLACEHOLDERS = ['แชทใหม่', 'New chat'];

/** Same rule as deriveTitle: first line, trimmed, cut at 60 characters. */
function deriveTitle(text) {
  const line = text.trim().split('\n')[0] ?? '';
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

const rows = await sql`
  select c.id,
         c.title,
         c.updated_at,
         (
           select m.parts -> 0 ->> 'text'
           from public.messages m
           where m.conversation_id = c.id and m.role = 'user'
           order by m.created_at asc
           limit 1
         ) as first_text
  from public.conversations c
  where c.title = any(${PLACEHOLDERS}::text[])
  order by c.updated_at desc`;

const fixable = [];
for (const r of rows) {
  const title = r.first_text ? deriveTitle(r.first_text) : null;
  fixable.push({ id: r.id, current: r.title, title, when: r.updated_at });
}

console.log(`conversations holding a placeholder title: ${rows.length}`);
for (const f of fixable) {
  const when = new Date(f.when).toISOString().slice(0, 16).replace('T', ' ');
  console.log(
    `  ${f.title ? 'rename' : 'skip  '}  "${f.current}" -> ${f.title ? `"${f.title}"` : '(no user message)'}`,
  );
  console.log(`          ${when}Z  ${f.id}`);
}

const apply = fixable.filter((f) => f.title);
if (dryRun) {
  console.log(`\n(dry run) would rename ${apply.length} conversation(s)`);
} else if (!apply.length) {
  console.log('\nnothing to rename');
} else {
  for (const f of apply) {
    await sql`update public.conversations set title = ${f.title} where id = ${f.id}`;
  }
  console.log(`\nrenamed ${apply.length} conversation(s)`);
}

await sql.end();