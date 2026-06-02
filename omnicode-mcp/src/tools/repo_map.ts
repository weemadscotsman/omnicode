import { initDb } from '../store/db';
import { scanRepoManifests, summarizeManifestScan } from '../engine/manifest_scanner';
import { makeOcapBuilder, resolveOcapFormat, OcapFormat } from '../engine/ocap';

export async function repoMap(repoPath: string, format: OcapFormat = 'auto') {
  const db = initDb(repoPath);
  try {
    const files = db.prepare(`
      SELECT f.id, f.path, f.lang, COUNT(s.id) as symbol_count
      FROM files f
      LEFT JOIN symbols s ON s.file_id = f.id
      GROUP BY f.id
      ORDER BY f.path ASC
    `).all() as any[];

    if (files.length === 0) {
      return { result: "Repository not indexed or empty." };
    }

    const resolvedFormat = resolveOcapFormat(format, files.length);

    if (resolvedFormat === 'ocap') {
      const ocap = makeOcapBuilder('repo_map', ['path', 'lang', 'symbols']);
      for (const f of files) {
        const relPath = f.path.replace(repoPath, '');
        const lang = f.lang || '';
        const pathId = ocap.intern('path', relPath);
        const langId = lang ? ocap.intern('lang', lang) : 0;
        ocap.push([pathId, langId, f.symbol_count]);
      }
      ocap.setFooter('files', files.length);
      return { result: ocap.toText() };
    }

    let formatted = "Repository Map:\n";

    for (const f of files) {
      const relPath = f.path.replace(repoPath, '');
      formatted += `- ${relPath} (${f.symbol_count} symbols)\n`;
    }

    if (formatted.length > 20000) {
       formatted = formatted.substring(0, 20000) + "\n... (truncated)";
    }

    const scan = scanRepoManifests(repoPath);
    formatted += `\n\nProject Manifests & Boundaries:\n${summarizeManifestScan(scan, repoPath)}\n`;
    return { result: formatted };
  } finally {
    db.close();
  }
}
