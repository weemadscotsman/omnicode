import { initDb } from '../store/db';

export async function findReferences(repoPath: string, symbolName: string) {
  const db = initDb(repoPath);

  const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName) as any;
  if (!targetSymbol) {
    return { result: `Symbol '${symbolName}' not found in index.` };
  }

  const incoming = db.prepare(`SELECT from_symbol FROM edges WHERE to_symbol = ?`).all(targetSymbol.id) as any[];
  
  if (incoming.length === 0) {
    return { result: `No references found for '${symbolName}' in the exact edges index.` };
  }

  let report = `Found ${incoming.length} references for '${symbolName}':\n`;
  for (const edge of incoming) {
    const caller = db.prepare(`SELECT s.name, s.kind, f.path, s.line FROM symbols s JOIN files f ON s.file_id = f.id WHERE s.id = ?`).get(edge.from_symbol) as any;
    if (caller) {
      report += `- ${caller.path}:${caller.line} ([${caller.kind}] ${caller.name})\n`;
    }
  }

  return { result: report };
}
