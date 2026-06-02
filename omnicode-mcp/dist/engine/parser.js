"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.langRegistry = void 0;
exports.parseSource = parseSource;
// OmniCode parser layer
// Goal: avoid "blind wall" failures. Tree-sitter is used when available;
// deterministic lightweight fallback parsers keep symbols/imports/calls visible
// for Python/Rust/Go/C# and any language parser that is not installed yet.
// @ts-ignore
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const module_1 = require("module");
const path_1 = __importDefault(require("path"));
const runtimeRequire = (0, module_1.createRequire)(__filename);
const EXT_TO_LANGUAGE = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'javascript',
    '.mjs': 'javascript', '.cjs': 'javascript', '.py': 'python', '.rs': 'rust',
    '.go': 'go', '.cs': 'c_sharp', '.java': 'java', '.kt': 'kotlin', '.php': 'php',
    '.rb': 'ruby', '.swift': 'swift', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.hpp': 'cpp',
    '.sol': 'solidity', '.lua': 'lua',
};
function makeBlindspot(code, severity, message, hint = '') {
    return `${code}|${severity}|${message}${hint ? `|hint=${hint}` : ''}`;
}
// Reserved words / control-flow keywords that are NEVER a declared symbol name.
// Without this, a broad "name(...)" regex records every `if (`, `for (`, `return (`
// as a "method" — e.g. "if" extracted 3,613× in one repo, detonating the graph.
// Covers JS/TS + the control words of the other fallback languages.
const RESERVED_SYMBOL_NAMES = new Set([
    // JS/TS
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do',
    'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in',
    'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
    'var', 'void', 'while', 'with', 'let', 'await', 'yield', 'async', 'of', 'as', 'from',
    // Python
    'def', 'elif', 'except', 'lambda', 'pass', 'raise', 'global', 'nonlocal', 'assert', 'del', 'and',
    'or', 'not', 'is', 'None', 'True', 'False', 'with', 'async', 'await',
    // Go / Rust / C-family control words a greedy regex can catch
    'func', 'fn', 'impl', 'match', 'loop', 'use', 'mod', 'pub', 'select', 'defer', 'go', 'chan', 'range',
    'foreach', 'using', 'namespace', 'unsafe', 'where', 'sizeof', 'typedef', 'struct', 'union', 'goto',
]);
/** Is `name` a plausible declared symbol identifier (and not a reserved keyword)? */
function isValidSymbolName(name) {
    if (!name)
        return false;
    const n = name.trim();
    if (n.length === 0 || n.length > 120)
        return false;
    if (RESERVED_SYMBOL_NAMES.has(n))
        return false;
    // Identifier shape across the supported languages (allows Ruby `?!=`, scoped `::`).
    return /^[A-Za-z_$][\w$]*[!?=]?$/.test(n) || /^[A-Za-z_$][\w$:]*$/.test(n);
}
class LanguageRegistry {
    parsers = {};
    loadedLanguages = [];
    fallbackLanguages = ['typescript', 'tsx', 'javascript', 'python', 'rust', 'go', 'c_sharp', 'java', 'kotlin', 'php', 'ruby', 'swift', 'c', 'cpp', 'solidity', 'lua'];
    constructor() {
        this.tryLoad('typescript', 'tree-sitter-typescript', (p) => p.typescript);
        this.tryLoad('tsx', 'tree-sitter-typescript', (p) => p.tsx);
        this.tryLoad('javascript', 'tree-sitter-javascript');
        this.tryLoad('python', 'tree-sitter-python');
        this.tryLoad('rust', 'tree-sitter-rust');
        this.tryLoad('go', 'tree-sitter-go');
        this.tryLoad('c_sharp', 'tree-sitter-c-sharp');
    }
    tryLoad(lang, pkg, extractor) {
        try {
            const parserMod = runtimeRequire(pkg);
            this.parsers[lang] = extractor ? extractor(parserMod) : parserMod;
            this.loadedLanguages.push(lang);
        }
        catch {
            // Do not spam stderr during MCP startup. language_support reports this honestly.
        }
    }
    getLanguage(ext) { return this.parsers[this.getLanguageName(ext)] ?? null; }
    getLanguageName(ext) { return EXT_TO_LANGUAGE[ext] ?? 'unknown'; }
    isLoadedLanguageName(languageName) { return this.loadedLanguages.includes(languageName); }
    hasFallback(languageName) { return this.fallbackLanguages.includes(languageName); }
}
exports.langRegistry = new LanguageRegistry();
function lineFromOffset(content, offset) {
    return content.slice(0, Math.max(0, offset)).split('\n').length;
}
function snippetForLine(content, start, end) {
    return content.slice(start, Math.min(content.length, end));
}
// Cap stored snippets. A symbol's full body is reconstructable from byte_start/
// byte_end (via get_file_slice), so storing entire multi-KB class/function bodies
// bloats the index (GOTHAM hit ~24 KB/symbol → ~1 GB). Most symbols are tiny;
// only giant bodies get truncated, keeping the DB bounded without losing reach.
const MAX_SNIPPET_CHARS = 1200;
function capSnippet(s) {
    return s.length > MAX_SNIPPET_CHARS
        ? s.slice(0, MAX_SNIPPET_CHARS) + '\n/* …truncated — use get_file_slice for the full body */'
        : s;
}
function symbolFromRegex(content, name, kind, start, endHint) {
    const line = lineFromOffset(content, start);
    const lineEnd = content.indexOf('\n', start);
    const end = endHint && endHint > start ? endHint : (lineEnd === -1 ? Math.min(content.length, start + 600) : lineEnd);
    return { name, kind, line, byteStart: start, byteEnd: end, snippet: snippetForLine(content, start, Math.min(content.length, end + 1)) };
}
function uniq(xs) { return Array.from(new Set(xs)); }
function extractImportsFallback(language, content) {
    const imports = [];
    const patterns = [];
    if (['typescript', 'tsx', 'javascript'].includes(language)) {
        patterns.push(/\bimport\s+(?:[^'"`]+?\s+from\s+)?['"`]([^'"`]+)['"`]/g);
        patterns.push(/\bexport\s+[^'"`]+?\s+from\s+['"`]([^'"`]+)['"`]/g);
        patterns.push(/\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
        patterns.push(/\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g);
    }
    else if (language === 'python') {
        patterns.push(/^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+\w+)?/gm);
        patterns.push(/^\s*from\s+(\.*[A-Za-z_][\w.]*)\s+import\s+/gm);
        patterns.push(/^\s*from\s+(\.+)\s+import\s+/gm);
    }
    else if (language === 'go') {
        patterns.push(/import\s+"([^"]+)"/g);
        patterns.push(/import\s*\([\s\S]*?"([^"]+)"[\s\S]*?\)/g);
    }
    else if (language === 'rust') {
        patterns.push(/^\s*use\s+([^;]+);/gm);
        patterns.push(/extern\s+crate\s+([\w_]+)/g);
        patterns.push(/mod\s+([\w_]+)\s*;/g);
    }
    else if (language === 'c_sharp') {
        patterns.push(/^\s*using\s+([\w.]+)\s*;/gm);
    }
    else if (language === 'java' || language === 'kotlin') {
        patterns.push(/^\s*import\s+([\w.*]+)\s*;/gm);
    }
    else if (language === 'php') {
        patterns.push(/require(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g);
        patterns.push(/include(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g);
        patterns.push(/^\s*use\s+([\\\w]+)\s*;/gm);
    }
    else if (language === 'ruby') {
        patterns.push(/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/gm);
    }
    else if (language === 'c' || language === 'cpp') {
        // Quoted includes are LOCAL project edges; angle includes (<stdio.h>) are
        // system/external and are intentionally not extracted (no repo edge).
        patterns.push(/#\s*include\s*"([^"]+)"/g);
    }
    else if (language === 'swift') {
        patterns.push(/^\s*(?:@testable\s+)?import\s+(?:(?:struct|class|enum|protocol|func|let|var|typealias)\s+)?([A-Za-z_][\w.]*)/gm);
    }
    else if (language === 'solidity') {
        // import "./X.sol";  import {A} from "./X.sol";  import "@openzeppelin/...";
        patterns.push(/import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/g);
    }
    else if (language === 'lua') {
        patterns.push(/require\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g);
    }
    for (const p of patterns) {
        let m;
        while ((m = p.exec(content)))
            if (m[1])
                imports.push(m[1].trim());
    }
    return uniq(imports);
}
function extractSymbolsFallback(language, content) {
    const out = [];
    const pushMatches = (kind, re, group = 1) => {
        let m;
        while ((m = re.exec(content))) {
            const name = m[group];
            if (!name)
                continue;
            out.push(symbolFromRegex(content, name, kind, m.index));
        }
    };
    if (['typescript', 'tsx', 'javascript'].includes(language)) {
        pushMatches('function', /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g);
        pushMatches('class', /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/g);
        pushMatches('interface', /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g);
        pushMatches('type', /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/g);
        pushMatches('function', /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g);
        pushMatches('function', /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?function\b/g);
        pushMatches('method', /^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*[{:]?/gm);
    }
    else if (language === 'python') {
        pushMatches('function', /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)\s*\(/gm);
        pushMatches('class', /^\s*class\s+([A-Za-z_][\w]*)\b/gm);
    }
    else if (language === 'go') {
        pushMatches('function', /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/gm);
        pushMatches('type', /^\s*type\s+([A-Za-z_][\w]*)\s+(?:struct|interface|func|map|\[)/gm);
    }
    else if (language === 'rust') {
        pushMatches('function', /^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][\w]*)\s*\(/gm);
        pushMatches('struct', /^\s*(?:pub\s+)?struct\s+([A-Za-z_][\w]*)\b/gm);
        pushMatches('enum', /^\s*(?:pub\s+)?enum\s+([A-Za-z_][\w]*)\b/gm);
        pushMatches('trait', /^\s*(?:pub\s+)?trait\s+([A-Za-z_][\w]*)\b/gm);
        pushMatches('impl', /^\s*impl(?:<[^>]+>)?\s+([A-Za-z_][\w]*)\b/gm);
    }
    else if (language === 'c_sharp') {
        pushMatches('class', /\b(?:public|private|internal|protected|static|sealed|abstract|partial|record|\s)+\s*(?:class|record)\s+([A-Za-z_][\w]*)\b/g);
        pushMatches('interface', /\binterface\s+([A-Za-z_][\w]*)\b/g);
        pushMatches('method', /\b(?:public|private|internal|protected|static|async|virtual|override|sealed|partial|\s)+\s*[\w<>\[\],?]+\s+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*{/g);
    }
    else if (language === 'java' || language === 'kotlin') {
        pushMatches('class', /\b(?:class|interface|enum|object)\s+([A-Za-z_][\w]*)\b/g);
        pushMatches('method', /\b(?:public|private|protected|static|final|suspend|inline|\s)+\s*[\w<>\[\],?]+\s+([A-Za-z_][\w]*)\s*\([^;{}]*\)\s*{/g);
    }
    else if (language === 'php') {
        pushMatches('function', /\bfunction\s+([A-Za-z_][\w]*)\s*\(/g);
        pushMatches('class', /\b(?:class|interface|trait)\s+([A-Za-z_][\w]*)\b/g);
    }
    else if (language === 'ruby') {
        pushMatches('function', /^\s*def\s+([A-Za-z_][\w!?=]*)/gm);
        pushMatches('class', /^\s*class\s+([A-Za-z_:][\w:]*)/gm);
        pushMatches('module', /^\s*module\s+([A-Za-z_:][\w:]*)/gm);
    }
    else if (language === 'c' || language === 'cpp') {
        pushMatches('struct', /\b(?:struct|class|union|enum)\s+([A-Za-z_]\w*)\b/g);
        pushMatches('function', /^[A-Za-z_][\w\s\*&:<>]*?\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gm);
        // Prototypes/declarations (headers are mostly these) — still real symbols.
        pushMatches('declaration', /^[A-Za-z_][\w\s\*&:<>]*?\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*;/gm);
    }
    else if (language === 'swift') {
        pushMatches('function', /\bfunc\s+([A-Za-z_]\w*)\s*[(<]/g);
        pushMatches('class', /\b(?:final\s+)?(?:class|struct|enum|protocol|actor)\s+([A-Za-z_]\w*)\b/g);
        pushMatches('extension', /\bextension\s+([A-Za-z_]\w*)\b/g);
    }
    else if (language === 'solidity') {
        pushMatches('contract', /\b(?:contract|interface|library)\s+([A-Za-z_]\w*)/g);
        pushMatches('function', /\bfunction\s+([A-Za-z_]\w*)\s*\(/g);
        pushMatches('event', /\bevent\s+([A-Za-z_]\w*)\s*\(/g);
        pushMatches('modifier', /\bmodifier\s+([A-Za-z_]\w*)/g);
        pushMatches('struct', /\bstruct\s+([A-Za-z_]\w*)/g);
    }
    else if (language === 'lua') {
        // function f(), function M.f(), function M:f(), local function f()
        pushMatches('function', /\b(?:local\s+)?function\s+(?:[\w.:]*[.:])?([A-Za-z_]\w*)\s*\(/g);
        pushMatches('function', /\b([A-Za-z_]\w*)\s*=\s*function\s*\(/g);
    }
    const seen = new Set();
    return out.filter((s) => {
        if (!isValidSymbolName(s.name))
            return false; // reject keywords / control flow
        const key = `${s.kind}:${s.name}:${s.line}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}
function extractCallsFallback(language, content, symbols) {
    const edges = [];
    const callRe = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    const sorted = [...symbols].sort((a, b) => a.byteStart - b.byteStart);
    let m;
    while ((m = callRe.exec(content))) {
        const name = m[1];
        if (!isValidSymbolName(name) || name === 'require' || name === 'import')
            continue;
        let owner = null;
        for (const s of sorted) {
            if (s.byteStart <= m.index && s.byteEnd >= m.index) {
                owner = s.name;
                break;
            }
            if (s.byteStart <= m.index)
                owner = s.name;
        }
        edges.push({ fromSymbol: owner, toSymbolName: name });
    }
    return edges;
}
function fallbackParse(filePath, content, languageName, reason) {
    const symbols = extractSymbolsFallback(languageName, content);
    const imports = extractImportsFallback(languageName, content);
    const callEdges = extractCallsFallback(languageName, content, symbols);
    const blindspots = [];
    const hasDynamicSignals = /\b(eval|Function\s*\(|setTimeout\s*\(\s*['"`]|getattr\s*\(|globals\s*\(|locals\s*\(|__import__\s*\(|Reflect\.|Assembly\.Load|dlopen|require\s*\(\s*[^'"`]|import\s*\(\s*[^'"`])/.test(content);
    if (reason)
        blindspots.push(makeBlindspot('DEGRADED_PARSE', symbols.length ? 'warn' : 'error', reason, 'install native parser or use LSP fallback for semantic resolution'));
    if (hasDynamicSignals)
        blindspots.push(makeBlindspot('DYNAMIC_RUNTIME_REFERENCE', 'warn', 'runtime/dynamic references detected', 'use runtime_trace or LSP/ABI resolver before deleting/renaming'));
    const quality = symbols.length > 0 ? (hasDynamicSignals ? 0.55 : 0.68) : 0.15;
    return { symbols, imports, callEdges, blindspots, parserMode: symbols.length ? 'fallback' : 'none', parseQuality: quality, languageName };
}
function parseSource(filePath, content) {
    const ext = path_1.default.extname(filePath);
    const languageName = exports.langRegistry.getLanguageName(ext);
    const langConfig = exports.langRegistry.getLanguage(ext);
    if (!langConfig) {
        if (exports.langRegistry.hasFallback(languageName)) {
            return fallbackParse(filePath, content, languageName, `Tree-sitter parser not loaded for ${languageName}`);
        }
        return { symbols: [], callEdges: [], imports: [], blindspots: [makeBlindspot('UNSUPPORTED_EXTENSION', 'error', `Unsupported extension: ${ext}`, 'add scanner/parser support or ignore this file type')], parserMode: 'none', parseQuality: 0, languageName };
    }
    const symbols = [];
    const callEdges = [];
    const imports = [];
    const blindspots = [];
    const unquote = (s) => s.replace(/^[\'"`]|[\'"`]$/g, '');
    try {
        const parser = new tree_sitter_1.default();
        parser.setLanguage(langConfig);
        // node-tree-sitter's parse buffer defaults to 32KB; any larger file throws
        // "Invalid argument" and silently degrades to the regex fallback. Size the
        // buffer to the file so large files (the important ones!) get a real AST.
        const tree = parser.parse(content, undefined, { bufferSize: Math.max(32 * 1024, content.length + 4096) });
        let activeSymbol = null;
        let parseErrors = 0;
        const walk = (node) => {
            let currentActiveSymbol = activeSymbol;
            const isDecl = node.type.includes('declaration') || node.type.includes('definition') || node.type === 'function_item' || node.type === 'method_definition' || node.type === 'class_declaration';
            if (isDecl && node.type !== 'variable_declaration') {
                const nameNode = node.childForFieldName('name') || node.childForFieldName('identifier');
                if (nameNode && isValidSymbolName(nameNode.text)) {
                    const symName = nameNode.text;
                    currentActiveSymbol = symName;
                    symbols.push({ name: symName, kind: node.type.replace('_declaration', '').replace('_definition', '').replace('_item', ''), line: node.startPosition.row + 1, byteStart: node.startIndex, byteEnd: node.endIndex, snippet: capSnippet(content.substring(node.startIndex, node.endIndex)) });
                }
            }
            else if (node.type === 'variable_declarator') {
                const nameNode = node.childForFieldName('name');
                const valueNode = node.childForFieldName('value');
                if (nameNode && valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function') && isValidSymbolName(nameNode.text)) {
                    currentActiveSymbol = nameNode.text;
                    symbols.push({ name: currentActiveSymbol, kind: 'function', line: node.startPosition.row + 1, byteStart: node.startIndex, byteEnd: node.endIndex, snippet: capSnippet(content.substring(node.startIndex, node.endIndex)) });
                }
            }
            if (node.type === 'call_expression') {
                const fnNode = node.childForFieldName('function');
                if (fnNode) {
                    let calledName = fnNode.text;
                    if (fnNode.type === 'member_expression') {
                        const propNode = fnNode.childForFieldName('property');
                        if (propNode)
                            calledName = propNode.text;
                    }
                    if (isValidSymbolName(calledName)) {
                        callEdges.push({ fromSymbol: currentActiveSymbol, toSymbolName: calledName });
                    }
                    if (fnNode.text === 'require' || fnNode.text === 'import') {
                        const args = node.childForFieldName('arguments');
                        const first = args && args.namedChildCount > 0 ? args.namedChild(0) : null;
                        if (first && first.type === 'string')
                            imports.push(unquote(first.text));
                        else
                            blindspots.push(makeBlindspot('DYNAMIC_IMPORT', 'warn', `Dynamic import/require near line ${node.startPosition.row + 1}`, 'runtime value needed for exact edge'));
                    }
                }
            }
            if (node.type === 'import_statement' || node.type === 'export_statement') {
                const sourceNode = node.childForFieldName('source');
                if (sourceNode && sourceNode.type === 'string')
                    imports.push(unquote(sourceNode.text));
            }
            // Flag only ACTUAL error/missing nodes (precise), not every ancestor that
            // merely contains one. And skip null-byte artifacts: node-tree-sitter's
            // string reader can inject a spurious null-byte ERROR node mid-parse on a
            // perfectly valid file. A real source file never contains a null byte, so
            // such a node is a tool artifact, not a code problem — don't report it or
            // dock parse quality for it.
            const isErrorNode = node.type === 'ERROR' || node.isMissing === true;
            if (isErrorNode && parseErrors < 20) {
                const isNullByteArtifact = typeof node.text === 'string' && node.text.includes(String.fromCharCode(0));
                if (!isNullByteArtifact) {
                    parseErrors++;
                    blindspots.push(makeBlindspot('PARSE_ERROR', 'warn', `Parse error near line ${node.startPosition.row + 1}`, 'file may contain unsupported syntax or partial generated code'));
                }
            }
            for (let i = 0; i < node.childCount; i++) {
                const orig = activeSymbol;
                activeSymbol = currentActiveSymbol;
                walk(node.child(i));
                activeSymbol = orig;
            }
        };
        walk(tree.rootNode);
        // Tree-sitter can miss common language nodes depending on grammar naming. Merge deterministic fallback without duplicating.
        const fallback = fallbackParse(filePath, content, languageName, '');
        const seen = new Set(symbols.map((s) => `${s.kind}:${s.name}:${s.line}`));
        for (const s of fallback.symbols) {
            // tree-sitter already captured real methods precisely via method_definition.
            // The fallback's broad `method` regex mostly catches CALL sites at line start
            // (useEffect(), toast()), so drop it on the tree-sitter path. Keep the other
            // kinds (function/class/interface/type/enum) in case the grammar missed one.
            if (s.kind === 'method')
                continue;
            const key = `${s.kind}:${s.name}:${s.line}`;
            if (!seen.has(key))
                symbols.push(s);
        }
        imports.push(...fallback.imports);
        callEdges.push(...fallback.callEdges);
        for (const b of fallback.blindspots.filter((x) => !x.startsWith('DEGRADED_PARSE')))
            blindspots.push(b);
        const parseQuality = Math.max(0.35, Math.min(1, 1 - (parseErrors * 0.04) - (blindspots.filter((b) => b.includes('DYNAMIC')).length * 0.03)));
        return { symbols, callEdges, imports: uniq(imports), blindspots: uniq(blindspots), parserMode: 'tree-sitter', parseQuality, languageName };
    }
    catch (err) {
        return fallbackParse(filePath, content, languageName, `Tree-sitter failed for ${filePath}: ${err.message}`);
    }
}
