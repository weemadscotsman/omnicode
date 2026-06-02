"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDbPath = getDbPath;
exports.initDb = initDb;
exports.resolveGraphEdges = resolveGraphEdges;
exports.refreshPageRank = refreshPageRank;
exports.refreshImportanceScores = refreshImportanceScores;
exports.setIndexMeta = setIndexMeta;
exports.getIndexMeta = getIndexMeta;
exports.refreshFileSignals = refreshFileSignals;
exports.recordFileTouch = recordFileTouch;
exports.getConnectivityCounts = getConnectivityCounts;
exports.getStagedFiles = getStagedFiles;
exports.getFileProtection = getFileProtection;
exports.getIndexStats = getIndexStats;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
const pagerank_1 = require("../engine/pagerank");
function getDbPath(repoPath) {
    const normalizedRepoPath = path_1.default.resolve(repoPath);
    const hash = crypto_1.default.createHash('sha256').update(normalizedRepoPath).digest('hex').substring(0, 12);
    const dir = process.env.OMNICODE_DB_DIR
        ? path_1.default.resolve(process.env.OMNICODE_DB_DIR)
        : path_1.default.join(os_1.default.homedir(), '.omnicode');
    if (!fs_1.default.existsSync(dir)) {
        fs_1.default.mkdirSync(dir, { recursive: true });
    }
    return path_1.default.join(dir, `${hash}.db`);
}
function initDb(repoPath) {
    const dbPath = getDbPath(repoPath);
    const db = new better_sqlite3_1.default(dbPath);
    const schema = `
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      lang TEXT,
      size INTEGER,
      lines INTEGER,
      hash TEXT,
      pagerank REAL DEFAULT 0,
      parser_mode TEXT DEFAULT 'unknown',
      parse_quality REAL DEFAULT 0,
      language_name TEXT DEFAULT 'unknown',
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_id TEXT NOT NULL,
      line INTEGER,
      byte_start INTEGER,
      byte_end INTEGER,
      export_status TEXT,
      goop_score REAL DEFAULT 0,
      importance_score REAL DEFAULT 0,
      fossil_status TEXT,
      snippet TEXT,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY,
      from_symbol TEXT NOT NULL,
      to_symbol TEXT NOT NULL,
      type TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS blindspots (
      id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS call_edges (
      id TEXT PRIMARY KEY,
      from_symbol TEXT NOT NULL,
      to_symbol TEXT NOT NULL,
      file_id TEXT
    );

    CREATE TABLE IF NOT EXISTS imports (
      id TEXT PRIMARY KEY,
      from_file_id TEXT NOT NULL,
      specifier TEXT NOT NULL,
      to_file_id TEXT
    );

    CREATE TABLE IF NOT EXISTS symbol_embeddings (
      symbol_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_imports_from ON imports(from_file_id);
    CREATE INDEX IF NOT EXISTS idx_imports_to ON imports(to_file_id);

    CREATE TABLE IF NOT EXISTS index_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    -- Per-file connectivity + learned user intent. Separate from blindspots:
    -- a file can parse perfectly, be wired to nothing, and still be the thing the
    -- user reaches for every session. Connectivity is recomputed each index;
    -- intent counters/score persist across indexes for surviving files.
    CREATE TABLE IF NOT EXISTS file_signals (
      file_id TEXT PRIMARY KEY,
      connectivity TEXT NOT NULL DEFAULT 'CONNECTED',
      in_degree INTEGER DEFAULT 0,
      out_degree INTEGER DEFAULT 0,
      export_count INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0,
      pull_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0,
      touch_count INTEGER DEFAULT 0,
      last_user_touch DATETIME,
      intent_score REAL DEFAULT 0,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    -- Zero Unknown Files ledger: every file ends in exactly one resolution state
    -- with proof (reason + resolver_used + confidence). "Skipped" is not a state.
    CREATE TABLE IF NOT EXISTS resolution (
      file_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL DEFAULT 'unknown',
      state TEXT NOT NULL DEFAULT 'failed_with_reason',
      reason TEXT,
      resolver_used TEXT,
      confidence REAL DEFAULT 0,
      FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audit (
      id TEXT PRIMARY KEY,
      ts DATETIME DEFAULT CURRENT_TIMESTAMP,
      user TEXT,
      role TEXT,
      tool TEXT,
      outcome TEXT,
      detail TEXT
    );

    CREATE TRIGGER IF NOT EXISTS update_importance_score_insert
    AFTER INSERT ON edges
    BEGIN
      UPDATE symbols 
      SET importance_score = importance_score + 1 
      WHERE id = NEW.to_symbol;
    END;

    CREATE INDEX IF NOT EXISTS idx_symbols_file_id ON symbols(file_id);
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_edges_from_symbol ON edges(from_symbol);
    CREATE INDEX IF NOT EXISTS idx_edges_to_symbol ON edges(to_symbol);
    CREATE INDEX IF NOT EXISTS idx_call_edges_from_symbol ON call_edges(from_symbol);
    CREATE INDEX IF NOT EXISTS idx_call_edges_to_symbol ON call_edges(to_symbol);
  `;
    db.exec(schema);
    // Migrations for older DBs — each guarded so re-runs are no-ops.
    try {
        db.exec(`ALTER TABLE call_edges ADD COLUMN file_id TEXT`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE files ADD COLUMN pagerank REAL DEFAULT 0`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE files ADD COLUMN parser_mode TEXT DEFAULT 'unknown'`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE files ADD COLUMN parse_quality REAL DEFAULT 0`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE files ADD COLUMN language_name TEXT DEFAULT 'unknown'`);
    }
    catch { /* exists */ }
    // v0.2 audit trail hardening: every invoke_tool call now records its caller, repo, and args hash.
    try {
        db.exec(`ALTER TABLE audit ADD COLUMN args_hash TEXT`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE audit ADD COLUMN caller TEXT`);
    }
    catch { /* exists */ }
    try {
        db.exec(`ALTER TABLE audit ADD COLUMN repo TEXT`);
    }
    catch { /* exists */ }
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    return db;
}
// Names that are never meaningful call targets — language keywords / control flow.
// A defense in depth: the parser shouldn't emit these as symbols, but if it does
// (e.g. an "if" extracted 3,613× in a large repo), they must not enter the graph.
const NON_SYMBOL_NAMES = new Set([
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'return', 'break',
    'continue', 'try', 'catch', 'finally', 'throw', 'new', 'delete', 'typeof',
    'void', 'in', 'of', 'instanceof', 'await', 'yield', 'function', 'class',
    'const', 'let', 'var', 'import', 'export', 'default', 'this', 'super',
    'null', 'undefined', 'true', 'false', 'as', 'from',
]);
// If a call name resolves to more than this many symbols (and none in the same
// file), the target is genuinely ambiguous — emitting one edge per candidate
// would create N false edges. Skip it: no edge beats N wrong edges. This also
// bounds the work to O(edges), killing the old O(N²) name-join blowup.
const AMBIGUITY_CAP = 8;
/**
 * Resolve symbol-name call edges into concrete symbol→symbol graph edges.
 * Pure JS, single pass: file-scoped resolution first, ambiguity-capped global
 * fallback, junk-name filtered. O(call_edges), not O(symbols²).
 */
function resolveGraphEdges(db) {
    db.prepare(`DELETE FROM edges WHERE type = ?`).run('call');
    const symbols = db.prepare(`SELECT id, name, file_id FROM symbols`).all();
    const globalByName = new Map();
    const fileByName = new Map();
    for (const s of symbols) {
        let g = globalByName.get(s.name);
        if (!g) {
            g = [];
            globalByName.set(s.name, g);
        }
        g.push(s.id);
        let fm = fileByName.get(s.file_id);
        if (!fm) {
            fm = new Map();
            fileByName.set(s.file_id, fm);
        }
        let fn = fm.get(s.name);
        if (!fn) {
            fn = [];
            fm.set(s.name, fn);
        }
        fn.push(s.id);
    }
    const edges = db.prepare(`SELECT from_symbol, to_symbol, file_id FROM call_edges WHERE from_symbol IS NOT NULL`).all();
    const resolve = (name, fileId) => {
        if (!name || NON_SYMBOL_NAMES.has(name))
            return [];
        const fm = fileId ? fileByName.get(fileId) : undefined;
        const local = fm?.get(name);
        if (local && local.length)
            return local; // same-file wins
        const g = globalByName.get(name);
        if (!g || g.length === 0 || g.length > AMBIGUITY_CAP)
            return []; // too ambiguous → no edge
        return g;
    };
    const insertEdge = db.prepare(`INSERT INTO edges (id, from_symbol, to_symbol, type) VALUES (@id, @from_symbol, @to_symbol, @type)`);
    const seen = new Set();
    const tx = db.transaction(() => {
        for (const e of edges) {
            const fromIds = resolve(e.from_symbol, e.file_id);
            if (fromIds.length === 0 || fromIds.length > AMBIGUITY_CAP)
                continue;
            const toIds = resolve(e.to_symbol, e.file_id);
            if (toIds.length === 0)
                continue;
            for (const f of fromIds) {
                for (const t of toIds) {
                    if (f === t)
                        continue;
                    const key = `${f}->${t}`;
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    insertEdge.run({ id: crypto_1.default.randomUUID(), from_symbol: f, to_symbol: t, type: 'call' });
                }
            }
        }
    });
    tx();
}
/**
 * Resolve raw import specifiers into file→file edges and run real PageRank,
 * persisting a normalized centrality score per file. Replaces the old
 * "incoming edge count × 10" importance heuristic.
 */
function refreshPageRank(db) {
    const files = db.prepare(`SELECT id, path FROM files`).all();
    if (files.length === 0)
        return;
    const pathById = new Map(files.map((f) => [f.id, f.path]));
    const idByPath = new Map(files.map((f) => [f.path, f.id]));
    const fileSet = new Set(files.map((f) => f.path));
    const repoRoot = (0, pagerank_1.inferRepoRoot)(files.map((f) => f.path));
    const resolvers = (0, pagerank_1.loadTypeScriptResolvers)(repoRoot);
    const rawImports = db.prepare(`SELECT id, from_file_id, specifier FROM imports`).all();
    const edges = [];
    const updateImport = db.prepare(`UPDATE imports SET to_file_id = ? WHERE id = ?`);
    const resolveTx = db.transaction(() => {
        for (const imp of rawImports) {
            const fromPath = pathById.get(imp.from_file_id);
            if (!fromPath)
                continue;
            const toPath = (0, pagerank_1.resolveSpecifier)(imp.specifier, fromPath, fileSet, repoRoot, (0, pagerank_1.resolverForFile)(fromPath, resolvers));
            if (toPath) {
                edges.push([fromPath, toPath]);
                updateImport.run(idByPath.get(toPath) ?? null, imp.id);
            }
            else {
                updateImport.run(null, imp.id);
            }
        }
    });
    resolveTx();
    const { scores } = (0, pagerank_1.computePageRank)(files.map((f) => f.path), edges);
    const setPr = db.prepare(`UPDATE files SET pagerank = ? WHERE id = ?`);
    const prTx = db.transaction(() => {
        for (const f of files)
            setPr.run(scores.get(f.path) ?? 0, f.id);
    });
    prTx();
}
function refreshImportanceScores(db) {
    refreshPageRank(db);
    // Symbol importance fuses two real signals:
    //   • call-graph in-degree (how many symbols call this one)
    //   • the PageRank centrality of the file the symbol lives in (scaled up
    //     since normalized PageRank values are small fractions)
    db.exec(`
    UPDATE symbols
    SET importance_score =
      (SELECT COUNT(*) FROM edges WHERE to_symbol = symbols.id) * 10
      + COALESCE((SELECT pagerank FROM files WHERE files.id = symbols.file_id), 0) * 1000
      + COALESCE(goop_score, 0) * 2
  `);
}
function setIndexMeta(db, key, value) {
    db.prepare(`INSERT INTO index_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}
function getIndexMeta(db, key) {
    try {
        const row = db.prepare(`SELECT value FROM index_meta WHERE key = ?`).get(key);
        return row ? row.value : null;
    }
    catch {
        return null; // table may not exist on a never-indexed repo
    }
}
// Intent weights — tunable. Pulls/edits mean more than a passing open.
const INTENT_W = { open: 0.25, pull: 0.5, edit: 0.7, recency: 0.3 };
const INTENT_HALFLIFE_DAYS = 14;
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
function recencyDecay(lastIso, nowMs) {
    if (!lastIso)
        return 0;
    const last = Date.parse(lastIso);
    if (Number.isNaN(last))
        return 0;
    const days = Math.max(0, (nowMs - last) / 86400000);
    return Math.exp((-Math.LN2 * days) / INTENT_HALFLIFE_DAYS); // 1.0 now → 0.5 at half-life
}
function computeIntent(opens, pulls, edits, lastIso, nowMs) {
    return clamp01(INTENT_W.open * Math.log1p(opens) +
        INTENT_W.pull * Math.log1p(pulls) +
        INTENT_W.edit * Math.log1p(edits) +
        INTENT_W.recency * recencyDecay(lastIso, nowMs));
}
function classify(inDeg, outDeg, symbolCount, parserMode) {
    if (parserMode === 'skipped')
        return 'ORPHAN_CONFIG'; // stubs: unsupported/asset/minified
    if (inDeg > 0 && outDeg > 0)
        return 'CONNECTED';
    if (outDeg > 0 && inDeg === 0)
        return 'SOURCE_ONLY'; // entrypoint / root
    if (inDeg > 0 && outDeg === 0)
        return 'SINK_ONLY'; // leaf util / types
    // fully disconnected
    return symbolCount > 0 ? 'ORPHAN_STAGED' : 'ORPHAN_INERT';
}
/**
 * Recompute per-file connectivity from resolved imports + symbols. Must run AFTER
 * refreshImportanceScores (which resolves imports.to_file_id). UPSERTs connectivity
 * columns only — intent counters/score are preserved for surviving files.
 */
function refreshFileSignals(db) {
    const rows = db.prepare(`
    SELECT
      f.id AS file_id,
      f.parser_mode AS parser_mode,
      (SELECT COUNT(*) FROM imports i WHERE i.to_file_id = f.id) AS in_degree,
      (SELECT COUNT(DISTINCT i.to_file_id) FROM imports i WHERE i.from_file_id = f.id AND i.to_file_id IS NOT NULL) AS out_degree,
      (SELECT COUNT(*) FROM symbols s WHERE s.file_id = f.id) AS symbol_count
    FROM files f
  `).all();
    const upsert = db.prepare(`
    INSERT INTO file_signals (file_id, connectivity, in_degree, out_degree, export_count)
    VALUES (@file_id, @connectivity, @in_degree, @out_degree, @export_count)
    ON CONFLICT(file_id) DO UPDATE SET
      connectivity = excluded.connectivity,
      in_degree    = excluded.in_degree,
      out_degree   = excluded.out_degree,
      export_count = excluded.export_count
  `);
    const tx = db.transaction(() => {
        for (const r of rows) {
            upsert.run({
                file_id: r.file_id,
                connectivity: classify(r.in_degree, r.out_degree, r.symbol_count, r.parser_mode),
                in_degree: r.in_degree,
                out_degree: r.out_degree,
                export_count: r.symbol_count,
            });
        }
    });
    tx();
}
/**
 * Record a user interaction with a file and recompute its intent score. This is
 * the learning hook: session tools call it when the user opens/pulls/edits a file.
 * No-op if the file isn't indexed yet. Returns the new intent score, or null.
 */
function recordFileTouch(db, filePath, kind, nowMs = Date.now()) {
    const file = db.prepare(`SELECT id FROM files WHERE path = ?`).get(filePath);
    if (!file)
        return null;
    const nowIso = new Date(nowMs).toISOString();
    db.prepare(`
    INSERT INTO file_signals (file_id, open_count, pull_count, edit_count, touch_count, last_user_touch)
    VALUES (@id, @o, @p, @e, 1, @now)
    ON CONFLICT(file_id) DO UPDATE SET
      open_count  = open_count  + @o,
      pull_count  = pull_count  + @p,
      edit_count  = edit_count  + @e,
      touch_count = touch_count + 1,
      last_user_touch = @now
  `).run({ id: file.id, o: kind === 'open' ? 1 : 0, p: kind === 'pull' ? 1 : 0, e: kind === 'edit' ? 1 : 0, now: nowIso });
    const s = db.prepare(`SELECT open_count, pull_count, edit_count, last_user_touch FROM file_signals WHERE file_id = ?`)
        .get(file.id);
    const intent = computeIntent(s.open_count, s.pull_count, s.edit_count, s.last_user_touch, nowMs);
    db.prepare(`UPDATE file_signals SET intent_score = ? WHERE file_id = ?`).run(intent, file.id);
    return intent;
}
/** Connectivity counts for the report header. */
function getConnectivityCounts(db) {
    const rows = db.prepare(`SELECT connectivity, COUNT(*) c FROM file_signals GROUP BY connectivity`).all();
    return rows.reduce((a, r) => { a[r.connectivity] = r.c; return a; }, {});
}
/** Staged files, highest learned intent first — the "you keep reaching for this" list. */
function getStagedFiles(db, limit = 25) {
    return db.prepare(`
    SELECT f.path AS path, s.connectivity, s.in_degree, s.out_degree, s.export_count, s.touch_count, s.intent_score
    FROM file_signals s JOIN files f ON f.id = s.file_id
    WHERE s.connectivity = 'ORPHAN_STAGED'
    ORDER BY s.intent_score DESC, s.export_count DESC
    LIMIT ?
  `).all(limit);
}
// Intent above which a file is shielded from graph-only destructive evidence.
const INTENT_PROTECT_THRESHOLD = 0.2;
/**
 * The trust guarantee: a delete/rename candidate must clear BOTH the graph proof
 * AND this intent check. A staged file (built for later) or any file the user has
 * reached for is protected from destruction on "unreferenced" evidence alone.
 */
function getFileProtection(db, filePath) {
    const row = db.prepare(`
    SELECT s.connectivity, s.intent_score
    FROM file_signals s JOIN files f ON f.id = s.file_id
    WHERE f.path = ?
  `).get(filePath);
    if (!row)
        return { protected: false, connectivity: null, intent_score: 0, reason: null };
    if (row.connectivity === 'ORPHAN_STAGED')
        return { protected: true, connectivity: row.connectivity, intent_score: row.intent_score, reason: 'staged: parses clean with exported API, not wired up yet — likely built for later' };
    if (row.intent_score > INTENT_PROTECT_THRESHOLD)
        return { protected: true, connectivity: row.connectivity, intent_score: row.intent_score, reason: `learned intent ${row.intent_score.toFixed(2)}: the user keeps reaching for this file` };
    return { protected: false, connectivity: row.connectivity, intent_score: row.intent_score, reason: null };
}
function getIndexStats(db) {
    return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM files) AS files,
      (SELECT COUNT(*) FROM symbols) AS symbols,
      (SELECT COUNT(*) FROM blindspots) AS blindspots,
      (SELECT COUNT(*) FROM edges) AS edges,
      (SELECT ROUND(AVG(parse_quality), 3) FROM files) AS avg_parse_quality,
      (SELECT COUNT(*) FROM files WHERE parser_mode = 'fallback') AS fallback_files,
      (SELECT COUNT(*) FROM files WHERE parser_mode = 'none') AS unparsed_files,
      (SELECT MAX(indexed_at) FROM files) AS indexed_at
  `).get();
}
