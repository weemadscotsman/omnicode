"use strict";
// ───────────────────────────────────────────────────────────────────────────
// SkillVault Phase One
//
// Indexed, on-demand retrieval over a directory of skill folders. Each
// skill folder is expected to have a `SKILL.md` with YAML frontmatter:
//
//   ---
//   name: <string>
//   description: <string>
//   origin: <string>
//   ---
//   # <Markdown body>
//
// The indexer scans once, writes a compact JSON index (.omnicode/skill-
// index.json) with per-skill metadata + a tokenised inverted index. Search
// is just `tokenize(description ∪ name)` with overlap scoring — no model,
// no embedding, byte-traceable. Full SKILL.md is read on demand only.
//
// Same philosophy as OmniCode itself: don't load every file; index once,
// retrieve exact relevant skills.
// ───────────────────────────────────────────────────────────────────────────
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseFrontMatter = parseFrontMatter;
exports.buildSkillIndex = buildSkillIndex;
exports.writeSkillIndexFile = writeSkillIndexFile;
exports.readSkillIndexFile = readSkillIndexFile;
exports.searchSkillIndex = searchSkillIndex;
exports.loadSkillBody = loadSkillBody;
exports.buildSkillPack = buildSkillPack;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const FRONT_MATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
function parseFrontMatter(content) {
    const match = content.match(FRONT_MATTER_RE);
    if (!match)
        return { meta: {}, body: content };
    const yaml = match[1];
    const body = match[2];
    const meta = {};
    for (const line of yaml.split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*?)\s*$/);
        if (m) {
            let v = m[2];
            if (v.startsWith('"') && v.endsWith('"'))
                v = v.slice(1, -1);
            if (v.startsWith("'") && v.endsWith("'"))
                v = v.slice(1, -1);
            meta[m[1]] = v;
        }
    }
    return { meta, body };
}
function tokenize(s) {
    return (s || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((x) => x.trim())
        .filter((x) => x.length >= 2);
}
function buildSkillIndex(skillsRoot) {
    const root = path_1.default.resolve(skillsRoot);
    if (!fs_1.default.existsSync(root))
        throw new Error(`skills root not found: ${root}`);
    const skills = [];
    let bytesTotal = 0;
    for (const entry of fs_1.default.readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const folder = path_1.default.join(root, entry.name);
        const skillMd = path_1.default.join(folder, 'SKILL.md');
        if (!fs_1.default.existsSync(skillMd))
            continue;
        const content = fs_1.default.readFileSync(skillMd, 'utf8');
        const { meta } = parseFrontMatter(content);
        const stat = fs_1.default.statSync(skillMd);
        const allFiles = fs_1.default.readdirSync(folder, { withFileTypes: true });
        const fileCount = allFiles.length;
        const hasReferences = allFiles.some((f) => f.name !== 'SKILL.md');
        const skill = {
            name: meta.name || entry.name,
            description: meta.description || '',
            origin: meta.origin || 'unknown',
            folder,
            rel_path: entry.name,
            skill_md_size: stat.size,
            has_references: hasReferences,
            file_count: fileCount,
            token_count_estimated: Math.ceil(stat.size / 4),
        };
        skills.push(skill);
        bytesTotal += stat.size;
    }
    // Deterministic order: alphabetical by name.
    skills.sort((a, b) => a.name.localeCompare(b.name));
    // Build inverted index from name + description.
    // Object.create(null) — without this, a token like "constructor" would
    // collide with Object.prototype.constructor (a function) and break the
    // push. Defensive against any future Object.prototype poisoning too.
    const inverted = Object.create(null);
    for (const s of skills) {
        const tokens = new Set([
            ...tokenize(s.name),
            ...tokenize(s.description),
        ]);
        for (const t of tokens) {
            if (!inverted[t])
                inverted[t] = [];
            inverted[t].push(s.name);
        }
    }
    for (const t of Object.keys(inverted)) {
        inverted[t].sort();
    }
    return {
        root,
        built_at: new Date().toISOString(),
        total_skills: skills.length,
        bytes_total: bytesTotal,
        skills,
        index: inverted,
    };
}
function writeSkillIndexFile(index, outPath) {
    fs_1.default.mkdirSync(path_1.default.dirname(outPath), { recursive: true });
    fs_1.default.writeFileSync(outPath, JSON.stringify(index), 'utf8');
    return outPath;
}
function readSkillIndexFile(indexPath) {
    if (!fs_1.default.existsSync(indexPath)) {
        throw new Error(`skill index not found: ${indexPath} — run \`omnicode skill-index <dir>\` first`);
    }
    return JSON.parse(fs_1.default.readFileSync(indexPath, 'utf8'));
}
function searchSkillIndex(index, query, limit = 5) {
    const tokens = tokenize(query);
    if (tokens.length === 0)
        return [];
    // Score each skill by token overlap. Token that appears in BOTH the
    // query and the skill's name (vs only description) scores higher.
    const byName = new Map(index.skills.map((s) => [s.name, s]));
    const scores = new Map();
    for (const tok of tokens) {
        const inName = index.index[tok] || [];
        // Also: check if any skill's name contains tok as a substring (handles
        // plurals and partial matches that tokenize() split differently).
        for (const skillName of inName) {
            const cur = scores.get(skillName) || { score: 0, matched: new Set() };
            cur.score += 2.0; // exact token match in name+description
            cur.matched.add(tok);
            scores.set(skillName, cur);
        }
        for (const s of index.skills) {
            const nameLower = s.name.toLowerCase();
            if (nameLower.includes(tok) && !inName.includes(s.name)) {
                const cur = scores.get(s.name) || { score: 0, matched: new Set() };
                cur.score += 1.0; // substring bonus
                cur.matched.add(tok);
                scores.set(s.name, cur);
            }
        }
    }
    // Sort and slice.
    const hits = [...scores.entries()]
        .map(([name, v]) => {
        const s = byName.get(name);
        return {
            name: s.name,
            description: s.description,
            origin: s.origin,
            rel_path: s.rel_path,
            score: v.score,
            matched_tokens: [...v.matched],
        };
    })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    return hits;
}
function loadSkillBody(index, skillName) {
    const meta = index.skills.find((s) => s.name === skillName);
    if (!meta)
        throw new Error(`skill not found: ${skillName}`);
    const skillMd = path_1.default.join(meta.folder, 'SKILL.md');
    if (!fs_1.default.existsSync(skillMd)) {
        throw new Error(`SKILL.md missing at ${skillMd} (index is stale; re-run \`omnicode skill-index\`)`);
    }
    const content = fs_1.default.readFileSync(skillMd, 'utf8');
    const { body } = parseFrontMatter(content);
    return { meta, body };
}
const COVERAGE_BONUS = 1.0; // weight for new (uncovered) tokens
const OVERLAP_PENALTY = 0.6; // weight for tokens already in the pack
function buildSkillPack(index, task, limit = 5, candidatePool = 25) {
    // 1. Cast a wide net: get top-N candidates by raw relevance.
    const candidates = searchSkillIndex(index, task, candidatePool);
    if (!candidates.length) {
        return { task, pack_size: 0, total_candidates_considered: 0, estimated_total_tokens: 0, pack: [] };
    }
    // 2. Tokenise the task to know what we're trying to cover.
    const taskTokens = new Set(tokenize(task));
    const covered = new Set(); // tokens already in the pack
    // 3. Greedy selection.
    const pack = [];
    const pool = [...candidates];
    while (pack.length < limit && pool.length > 0) {
        // Score each remaining candidate: relevance − overlap with covered set.
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (let i = 0; i < pool.length; i++) {
            const c = pool[i];
            // Compute this skill's token contributions
            const skillTokens = new Set([...tokenize(c.name), ...tokenize(c.description)]);
            let newTokens = 0;
            let overlapTokens = 0;
            for (const t of skillTokens) {
                if (covered.has(t))
                    overlapTokens++;
                else if (taskTokens.has(t))
                    newTokens++;
            }
            // Adjusted score: original relevance, plus bonus for new task-tokens,
            // minus penalty for already-covered tokens.
            const adjusted = c.score + COVERAGE_BONUS * newTokens - OVERLAP_PENALTY * overlapTokens;
            if (adjusted > bestScore) {
                bestScore = adjusted;
                bestIdx = i;
            }
        }
        if (bestIdx < 0)
            break;
        const chosen = pool.splice(bestIdx, 1)[0];
        // Mark this skill's tokens as covered.
        const newTokens = [];
        for (const t of new Set([...tokenize(chosen.name), ...tokenize(chosen.description)])) {
            if (!covered.has(t)) {
                covered.add(t);
                if (taskTokens.has(t))
                    newTokens.push(t);
            }
        }
        const meta = index.skills.find((s) => s.name === chosen.name);
        pack.push({
            name: chosen.name,
            description: chosen.description,
            origin: chosen.origin,
            rel_path: chosen.rel_path,
            score: Math.round(bestScore * 100) / 100,
            coverage_tokens: newTokens,
            matched_tokens: chosen.matched_tokens,
        });
    }
    // 4. Estimate total tokens for the pack (sum of SKILL.md sizes).
    const nameToSize = new Map(index.skills.map((s) => [s.name, s.skill_md_size]));
    const estimated = pack.reduce((acc, p) => acc + (nameToSize.get(p.name) || 0), 0);
    return {
        task,
        pack_size: pack.length,
        total_candidates_considered: candidates.length,
        estimated_total_tokens: Math.ceil(estimated / 4),
        pack,
    };
}
