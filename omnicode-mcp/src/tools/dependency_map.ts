import { initDb } from '../store/db';

export async function dependencyMap(repoPath: string, symbolName: string) {
  const db = initDb(repoPath);
  
  const symbol = db.prepare(`SELECT id, name FROM symbols WHERE name = ? LIMIT 1`).get(symbolName) as any;
  if (!symbol) {
    return { result: `Symbol '${symbolName}' not found.` };
  }

  const edges = db.prepare(`
    SELECT e.type, s.name, s.kind, f.path
    FROM edges e
    JOIN symbols s ON e.to_symbol = s.id
    JOIN files f ON s.file_id = f.id
    WHERE e.from_symbol = ?
  `).all(symbol.id) as any[];

  if (edges.length === 0) {
    return { result: `No known dependencies found for ${symbolName} in the graph index.` };
  }

  const formatted = edges.map(e => `[${e.type}] ${e.kind} ${e.name} (${e.path})`).join('\n');
  return { result: `Dependencies for ${symbolName}:\n${formatted}` };
}
