import { initDb } from '../store/db';
import { langRegistry } from '../engine/parser';
import { formatRepoVisionGate, getRepoVisionGate } from '../engine/repo_vision_gate';

export async function languageSupport(repoPath: string) {
  const db = initDb(repoPath);
  const rows = db.prepare(`
    SELECT language_name, parser_mode, COUNT(*) AS count, ROUND(AVG(parse_quality), 3) AS quality
    FROM files
    GROUP BY language_name, parser_mode
    ORDER BY count DESC
  `).all() as { language_name: string; parser_mode: string; count: number; quality: number }[];

  let result = `Language Support & Parsing Status:\n\n`;
  if (rows.length === 0) result += `No files indexed yet. Run index_project first.\n`;

  for (const row of rows) {
    const nativeLoaded = langRegistry.isLoadedLanguageName(row.language_name);
    const fallback = langRegistry.hasFallback(row.language_name);
    result += `- ${row.language_name || 'unknown'}: ${row.count} files · mode=${row.parser_mode} · tree-sitter=${nativeLoaded ? 'YES' : 'NO'} · fallback=${fallback ? 'YES' : 'NO'} · quality=${row.quality ?? 0}\n`;
  }

  const loaded = langRegistry.loadedLanguages.length > 0 ? langRegistry.loadedLanguages.join(', ') : 'none';
  result += `\nNative parsers loaded: ${loaded}\n`;
  result += `Fallback parsers available: ${langRegistry.fallbackLanguages.join(', ')}\n`;
  result += `\n${formatRepoVisionGate(getRepoVisionGate(db))}\n`;
  result += `\nRule: fallback means OmniCode can still extract symbols/imports/calls, but repair plans must treat those files as lower-confidence until native parser or LSP proof is available.`;
  return { result };
}
