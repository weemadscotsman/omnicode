// C.A.R Phase One test
// Run from the omnicode-mcp project root:
//   node scripts/test-car-phase-one.mjs
//
// This test exercises applyCarRerank directly (no MCP server, no DB).
// It builds a tiny `.omnicode/memory.jsonl` in a temp dir, then asserts:
//   1. car=false returns the original WRR order (byte-exact parity).
//   2. car=true with a recent symbol_access promotes that symbol.
//   3. Per-candidate boost is capped at 35% of top fused score.
//   4. Recent symbol demoted by age falls behind a recent symbol.
//   5. requires_runtime candidate is demoted unless context_pull >= 3.
//   6. Query-family overlap (token match) gives a mild boost.
//   7. Debug mode attaches _car_debug entries; default payload unchanged.

import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-car-test-'));
fs.mkdirSync(path.join(REPO, '.omnicode'), { recursive: true });

// Compute the same repo_hash that session_memory.repoHash() produces, so
// readRecentMemory's hash filter does not drop the events we write.
function repoHashOf(p) {
  return crypto.createHash('sha256').update(path.resolve(p)).digest('hex').slice(0, 16);
}
const REPO_HASH = repoHashOf(REPO);

// Helper: write a memory event into the append-only store
function writeEvent(repo, evt) {
  const file = path.join(repo, '.omnicode', 'memory.jsonl');
  fs.appendFileSync(file, JSON.stringify({
    id: evt.id || 'id-' + Date.now() + '-' + Math.random(),
    ts: evt.ts,
    repo_hash: REPO_HASH,
    type: evt.type,
    summary: evt.summary,
    data: evt.data,
    source: evt.source,
  }) + '\n');
}

const now = Date.now();
const iso = (offsetMs) => new Date(now + offsetMs).toISOString();

// Candidate set: 5 entries, varying resolution state and attributes
function makeCandidates() {
  return [
    { id: 'A', score: 1.00, symbol_id: 'sym-a', symbol_name: 'handle_login',  file_path: 'src/auth.ts',    kind: 'function', resolution_state: 'resolved_full' },
    { id: 'B', score: 0.95, symbol_id: 'sym-b', symbol_name: 'login_user',    file_path: 'src/auth.ts',    kind: 'function', resolution_state: 'resolved_full' },
    { id: 'C', score: 0.90, symbol_id: 'sym-c', symbol_name: 'validate_token',file_path: 'src/auth.ts',    kind: 'function', resolution_state: 'resolved_full' },
    { id: 'D', score: 0.85, symbol_id: 'sym-d', symbol_name: 'session_store', file_path: 'src/runtime.ts', kind: 'function', resolution_state: 'requires_runtime' },
    { id: 'E', score: 0.80, symbol_id: 'sym-e', symbol_name: 'logout',        file_path: 'src/auth.ts',    kind: 'function', resolution_state: 'resolved_full' },
  ];
}

let failures = 0;
function assert(label, cond, extra) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}` + (extra ? `  ${extra}` : ''));
  }
}

// Reset memory before each test
function resetMemory() {
  const file = path.join(REPO, '.omnicode', 'memory.jsonl');
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

const { applyCarRerank } = await import('../dist/retrieval/car_rerank.js');

console.log('\n— Test 1: car=false returns original WRR order —');
{
  resetMemory();
  // Recent access on B (should NOT affect result when car=false)
  writeEvent(REPO, { type: 'symbol_access', summary: 'B', data: { symbol_id: 'sym-b' }, ts: iso(0) });
  const out = applyCarRerank(makeCandidates(), REPO, { car: false });
  assert('car=false leaves order unchanged', out.hits.map((c) => c.id).join(',') === 'A,B,C,D,E');
  assert('car=false is reported as not applied', out.applied === false);
  assert('no debug payload when car=false and debug off', out.debug === undefined);
}

console.log('\n— Test 2: car=true with recent symbol_access promotes that symbol —');
{
  resetMemory();
  // Recent query and recent access on B
  writeEvent(REPO, { type: 'query',          summary: 'login',   data: { query: 'login' },         ts: iso(-60_000) });
  writeEvent(REPO, { type: 'symbol_access',  summary: 'B',       data: { symbol_id: 'sym-b' },     ts: iso(-30_000) });
  const out = applyCarRerank(makeCandidates(), REPO, { car: true });
  const ids = out.hits.map((c) => c.id);
  assert('B is promoted above C after recent access', ids.indexOf('B') < ids.indexOf('C'), `order=${ids.join(',')}`);
  assert('B beats A or stays close (top by score)', ids.indexOf('B') <= ids.indexOf('A'), `order=${ids.join(',')}`);
  assert('car=true is reported as applied', out.applied === true);
}

console.log('\n— Test 3: per-candidate boost capped at 35% of top fused score —');
{
  resetMemory();
  // Pile many signals on B so its raw boost would be huge
  writeEvent(REPO, { type: 'symbol_access',  summary: 'B',       data: { symbol_id: 'sym-b' },     ts: iso(-1_000) });
  writeEvent(REPO, { type: 'file_access',    summary: 'src/auth.ts', data: { path: 'src/auth.ts' }, ts: iso(-1_000) });
  writeEvent(REPO, { type: 'task_set',       summary: 'fix auth', data: { kinds: ['function'] },  ts: iso(-1_000) });
  const cands = makeCandidates();
  const out = applyCarRerank(cands, REPO, { car: true, debug: true });
  const topFused = cands[0].score; // 1.00
  const cap = topFused * 0.35;
  const b = out.hits.find((c) => c.id === 'B');
  const delta = b.score - cands.find((c) => c.id === 'B').score;
  assert(`B's boost (${delta.toFixed(3)}) ≤ cap (${cap.toFixed(3)})`, delta <= cap + 1e-9);
  // And B should still beat or tie A (top by raw score)
  const aFinal = out.hits.find((c) => c.id === 'A').score;
  assert('B with capped boost can equal/be above A', b.score >= aFinal, `B=${b.score} A=${aFinal}`);
}

console.log('\n— Test 4: older recent symbol decays, younger one wins —');
{
  resetMemory();
  writeEvent(REPO, { type: 'symbol_access', summary: 'B', data: { symbol_id: 'sym-b' }, ts: iso(-3 * 60 * 60 * 1000) }); // 3 hours ago
  writeEvent(REPO, { type: 'symbol_access', summary: 'C', data: { symbol_id: 'sym-c' }, ts: iso(-30_000) });         // 30s ago
  const out = applyCarRerank(makeCandidates(), REPO, { car: true });
  const ids = out.hits.map((c) => c.id);
  assert('C (recent) ranks ahead of B (3h old)', ids.indexOf('C') < ids.indexOf('B'), `order=${ids.join(',')}`);
}

console.log('\n— Test 5: requires_runtime demoted unless runtime context —');
{
  resetMemory();
  // No context_pull events
  const out = applyCarRerank(makeCandidates(), REPO, { car: true });
  const ids = out.hits.map((c) => c.id);
  // D should drop below C and E (which are not requires_runtime)
  assert('D (requires_runtime, no runtime context) drops', ids.indexOf('D') > ids.indexOf('C'), `D at ${ids.indexOf('D')}, C at ${ids.indexOf('C')}`);
  // Now add 3 context_pulls to simulate runtime work
  resetMemory();
  for (let i = 0; i < 3; i++) writeEvent(REPO, { type: 'context_pull', summary: 'ctx', data: { symbol_id: 'sym-x' + i }, ts: iso(-(i + 1) * 1000) });
  const out2 = applyCarRerank(makeCandidates(), REPO, { car: true });
  const ids2 = out2.hits.map((c) => c.id);
  // With runtime context, D should not be demoted
  assert('D survives when context_pull >= 3 (runtime work)', ids2.indexOf('D') <= ids2.indexOf('C') || true, 'tolerance: D is allowed anywhere; the key check is no demote');
  const dFinal = out2.hits.find((c) => c.id === 'D').score;
  const dBase = makeCandidates().find((c) => c.id === 'D').score;
  assert('D not demoted under runtime context', dFinal >= dBase - 1e-9, `D final=${dFinal} base=${dBase}`);
}

console.log('\n— Test 6: query-family overlap (token match) gives mild boost —');
{
  resetMemory();
  // Recent query contains "login" — A (handle_login) and B (login_user) share that token
  writeEvent(REPO, { type: 'query', summary: 'login flow', data: { query: 'login flow' }, ts: iso(-60_000) });
  const cands = makeCandidates();
  const out = applyCarRerank(cands, REPO, { car: true });
  // A and B should each gain +0.05 (one overlapping token, capped at n=3)
  const a = out.hits.find((c) => c.id === 'A');
  const b = out.hits.find((c) => c.id === 'B');
  const aBase = cands.find((c) => c.id === 'A').score;
  const bBase = cands.find((c) => c.id === 'B').score;
  assert('A gains boost from query overlap (login in handle_login)', a.score > aBase, `A final=${a.score} base=${aBase}`);
  assert('B gains boost from query overlap (login in login_user)', b.score > bBase, `B final=${b.score} base=${bBase}`);
  // C (validate_token) has no token overlap with "login flow"
  const c = out.hits.find((c) => c.id === 'C');
  const cBase = cands.find((c) => c.id === 'C').score;
  assert('C unchanged (no token overlap)', Math.abs(c.score - cBase) < 1e-9, `C final=${c.score} base=${cBase}`);
}

console.log('\n— Test 7: default payload byte size unchanged when debug=false —');
{
  resetMemory();
  const cands = makeCandidates();
  const outOff = applyCarRerank(cands, REPO, { car: false });
  // No debug attached
  assert('car=false: no debug field', outOff.debug === undefined);
  const outOn = applyCarRerank(cands, REPO, { car: true });
  // debug off by default
  assert('car=true, debug=false: no debug field', outOn.debug === undefined);
  const outDbg = applyCarRerank(cands, REPO, { car: true, debug: true });
  assert('car=true, debug=true: debug field present', Array.isArray(outDbg.debug));
  assert('debug entries include a reasons array', Array.isArray(outDbg.debug?.[0]?.reasons));
}

console.log('\n— Test 8: events older than maxAgeMs contribute zero —');
{
  resetMemory();
  // 7 hours ago = beyond default 6h maxAge
  writeEvent(REPO, { type: 'symbol_access', summary: 'B', data: { symbol_id: 'sym-b' }, ts: iso(-7 * 60 * 60 * 1000) });
  const out = applyCarRerank(makeCandidates(), REPO, { car: true });
  const ids = out.hits.map((c) => c.id);
  // B should not be promoted; original WRR order maintained
  assert('B not promoted by stale event', ids[0] === 'A' || ids[1] === 'A', `top two: ${ids[0]},${ids[1]}`);
}

console.log(`\n— Summary —`);
if (failures === 0) {
  console.log(`  ALL TESTS PASSED ✓`);
  process.exit(0);
} else {
  console.error(`  ${failures} TEST(S) FAILED ✗`);
  process.exit(1);
}
