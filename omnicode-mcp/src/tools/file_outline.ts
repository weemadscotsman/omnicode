import { initDb } from '../store/db';

export async function fileOutline(repoPath: string, filePath: string) {
  const db = initDb(repoPath);
  try {
  
    const file = db.prepare(`SELECT id, path FROM files WHERE path LIKE ? LIMIT 1`).get(`%${filePath}`) as any;
  
    if (!file) {
      return { result: `File '${filePath}' not found in index.` };
    }

    const symbols = db.prepare(`
      SELECT name, kind, line
      FROM symbols
      WHERE file_id = ?
      ORDER BY line ASC
    `).all(file.id) as any[];

    if (symbols.length === 0) {
      return { result: `No symbols found in ${file.path}` };
    }

    const formatted = symbols.map(s => `Line ${s.line}: [${s.kind}] ${s.name}`).join('\n');
    return { result: `Outline for ${file.path}:\n${formatted}` };
  } finally {
    db.close();
  }
}
