/**
 * Verify the SlipOK credentials without spending any slip quota.
 *
 *   npm run slipok:check
 *
 * Hits the read-only `/quota` endpoint, which never consumes quota and never
 * needs a slip image. Use it to confirm BRANCH_ID + API_KEY are valid and that
 * the package hasn't expired.
 */
const branchId = process.env.SLIPOK_BRANCH_ID;
const apiKey = process.env.SLIPOK_API_KEY;

if (!branchId || !apiKey) {
  console.error('SLIPOK_BRANCH_ID / SLIPOK_API_KEY not set in .env.local');
  process.exit(1);
}

const url = `https://api.slipok.com/api/line/apikey/${branchId}/quota`;
console.log(`branch : ${branchId}`);
console.log(`key    : ${apiKey.slice(0, 6)}…${apiKey.slice(-4)} (${apiKey.length} chars)`);
console.log(`→ GET ${url}\n`);

const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 20_000);

try {
  const res = await fetch(url, {
    headers: { 'x-authorization': apiKey },
    signal: ac.signal,
  });

  const body = await res.text();
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    console.error(`✗ HTTP ${res.status} — non-JSON response:\n${body.slice(0, 300)}`);
    process.exit(1);
  }

  if (json.success && json.data) {
    const { quota, overQuota, specialQuota, endDate, specialEndDate } = json.data;
    console.log('✓ credentials accepted\n');
    console.log(`  remaining quota : ${quota}`);
    console.log(`  over quota      : ${overQuota ?? 0}`);
    console.log(`  special quota   : ${specialQuota ?? 0}`);
    console.log(`  package ends    : ${endDate ?? '(not reported)'}`);
    if (specialEndDate) console.log(`  special ends    : ${specialEndDate}`);
    console.log(`  log mode        : ${process.env.SLIPOK_LOG_MODE ?? '(unset → false)'}`);
    console.log(
      quota > 0
        ? '\nReady. Remember: with log:true the PromptPay receiver (xxx-xxx-0749) must be\nconfigured in SlipOK LINE LIFF, or every slip returns error 1014.'
        : '\n✗ quota exhausted — top up before accepting payments.',
    );
  } else {
    console.error(`✗ rejected (HTTP ${res.status})`);
    console.error(`  code    : ${json.code ?? '(none)'}`);
    console.error(`  message : ${json.message ?? body.slice(0, 200)}`);
    const hints = {
      1001: 'branch id does not exist',
      1002: 'API key is wrong for this branch',
      1003: 'package has expired',
      1004: 'package quota exhausted',
      1015: 'no package data found for this branch',
    };
    if (json.code && hints[json.code]) console.error(`  hint    : ${hints[json.code]}`);
    process.exit(1);
  }
} catch (err) {
  console.error(`✗ request failed: ${err.name === 'AbortError' ? 'timed out after 20s' : err.message}`);
  process.exit(1);
} finally {
  clearTimeout(timer);
}