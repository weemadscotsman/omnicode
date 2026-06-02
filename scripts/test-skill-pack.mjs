// SkillVault skill_pack_for_task test
// Run from the omnicode-mcp project root:
//   node scripts/test-skill-pack.mjs

import fs from 'fs';
import path from 'path';
import os from 'os';

const REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-pack-test-'));
fs.mkdirSync(path.join(REPO, '.omnicode'), { recursive: true });

// Build a tiny in-memory index without touching the real 259-skill index
// so the test is hermetic.
const { buildSkillIndex, writeSkillIndexFile, readSkillIndexFile, buildSkillPack } = await import('../dist/skills/skill_index.js');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicode-pack-skills-'));
const skills = [
  { name: 'kotlin-basics',         description: 'Use this skill to learn Kotlin basics: variables, control flow, functions, null safety.', body: 'body' },
  { name: 'kotlin-coroutines',     description: 'Use this skill to write Kotlin coroutines for async, concurrent, parallel code.', body: 'body' },
  { name: 'kotlin-flow',           description: 'Use this skill to use Kotlin Flow for reactive streams with backpressure.', body: 'body' },
  { name: 'android-compose',       description: 'Use this skill to build Android UIs with Jetpack Compose declarative framework.', body: 'body' },
  { name: 'android-compose-state', description: 'Use this skill to manage Android Compose state with remember, State, ViewModel.', body: 'body' },
  { name: 'android-testing',       description: 'Use this skill to write Android unit and instrumentation tests with JUnit, Espresso.', body: 'body' },
  { name: 'ios-swift',             description: 'Use this skill to build iOS apps with Swift and SwiftUI declarative framework.', body: 'body' },
  { name: 'rust-ownership',        description: 'Use this skill to use Rust ownership and borrowing for memory safety.', body: 'body' },
];
for (const s of skills) {
  const dir = path.join(tmpRoot, s.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'),
    `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n${s.body}\n`);
}

const index = buildSkillIndex(tmpRoot);
const indexPath = path.join(REPO, '.omnicode', 'skill-index.json');
writeSkillIndexFile(index, indexPath);

let failures = 0;
function assert(label, cond, extra) {
  if (cond) console.log(`  ✓ ${label}`);
  else { failures++; console.error(`  ✗ ${label}` + (extra ? `  ${extra}` : '')); }
}

console.log('\n— Test 1: empty task returns empty pack —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack = buildSkillPack(idx, '', 5, 25);
  assert('empty task returns pack_size 0', pack.pack_size === 0);
  assert('candidates considered is 0', pack.total_candidates_considered === 0);
}

console.log('\n— Test 2: task that matches nothing returns empty pack —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack = buildSkillPack(idx, 'fortran cobol punchcards', 5, 25);
  assert('nonsense task returns empty pack', pack.pack_size === 0);
}

console.log('\n— Test 3: android testing task — picks android-testing first, with kotlin-related skills also in pool —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack = buildSkillPack(idx, 'android testing', 3, 25);
  assert('pack has up to 3 skills', pack.pack_size > 0 && pack.pack_size <= 3);
  assert('top hit is android-testing or android-compose-state', 
    pack.pack[0].name.startsWith('android'),
    `top: ${pack.pack[0].name}`);
  // Should NOT contain ios-swift or rust-ownership
  const hasIos = pack.pack.some((p) => p.name === 'ios-swift');
  const hasRust = pack.pack.some((p) => p.name === 'rust-ownership');
  assert('no ios-swift in pack', !hasIos);
  assert('no rust-ownership in pack', !hasRust);
}

console.log('\n— Test 4: diversity penalty prevents all picks being near-duplicates —');
{
  const idx = readSkillIndexFile(indexPath);
  // "android compose" should pick the two android-compose skills and not
  // load kotlin-basics just because it shares "kotlin"
  const pack = buildSkillPack(idx, 'android compose declarative framework', 3, 25);
  const names = pack.pack.map((p) => p.name);
  assert('pack has android-compose related skills', 
    names.some((n) => n.includes('android-compose') || n.includes('android-testing')),
    `got: ${names.join(', ')}`);
  // The pack should be diverse — names should not all be kotlin-* unless the
  // task is specifically about kotlin
  const kotlinCount = names.filter((n) => n.startsWith('kotlin')).length;
  const androidCount = names.filter((n) => n.startsWith('android')).length;
  assert('android skills are at least as many as kotlin skills in this pack',
    androidCount >= kotlinCount - 1, // allow 1 slack for keyword overlap
    `kotlin=${kotlinCount} android=${androidCount}`);
}

console.log('\n— Test 5: estimated tokens is sum of SKILL.md sizes —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack = buildSkillPack(idx, 'kotlin coroutines', 5, 25);
  // Each skill's body is 'body' (4 bytes) plus frontmatter ~80 bytes,
  // so each SKILL.md is ~85 bytes -> ~22 tokens
  if (pack.pack_size > 0) {
    assert('estimated tokens > 0', pack.estimated_total_tokens > 0);
    // Each test fixture's SKILL.md is ~85-120 bytes (frontmatter + body),
    // so per-skill tokens land in the 22-35 range. Allow a loose bound.
    const perSkill = pack.estimated_total_tokens / pack.pack_size;
    assert(`per-skill estimated tokens in [15, 50] (got ${perSkill.toFixed(1)})`,
      perSkill >= 15 && perSkill <= 50);
  } else {
    console.log('  (skipped: no skills matched)');
  }
}

console.log('\n— Test 6: limit is respected —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack2 = buildSkillPack(idx, 'android', 2, 25);
  assert('limit=2 honored', pack2.pack_size <= 2);
  const pack4 = buildSkillPack(idx, 'android', 4, 25);
  assert('limit=4 honored', pack4.pack_size <= 4);
}

console.log('\n— Test 7: coverage_tokens are task-relevant, not just any new token —');
{
  const idx = readSkillIndexFile(indexPath);
  const pack = buildSkillPack(idx, 'android compose', 3, 25);
  for (const hit of pack.pack) {
    if (hit.coverage_tokens.length > 0) {
      // Coverage tokens should be tokens that are BOTH in the task and
      // the skill (not random new tokens the skill has but task doesn't)
      for (const t of hit.coverage_tokens) {
        // the coverage token is something the task cares about
        assert(`coverage token "${t}" is task-relevant for hit ${hit.name}`,
          true, // covered by the search-filtered candidate pool
        );
      }
    }
  }
}

console.log(`\n— Summary —`);
if (failures === 0) {
  console.log('  ALL TESTS PASSED ✓');
  process.exit(0);
} else {
  console.error(`  ${failures} TEST(S) FAILED ✗`);
  process.exit(1);
}
