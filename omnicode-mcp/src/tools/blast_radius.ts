import { initDb } from '../store/db';

export async function blastRadius(repoPath: string, symbolName: string) {
  const db = initDb(repoPath);
  
  const symbol = db.prepare(`SELECT id, name FROM symbols WHERE name = ? LIMIT 1`).get(symbolName) as any;
  if (!symbol) {
    return { result: `Symbol '${symbolName}' not found.` };
  }

  const callers = db.prepare(`
    SELECT e.type, s.name, s.kind, f.path
    FROM edges e
    JOIN symbols s ON e.from_symbol = s.id
    JOIN files f ON s.file_id = f.id
    WHERE e.to_symbol = ?
  `).all(symbol.id) as any[];

  if (callers.length === 0) {
    return { result: `Blast Radius for ${symbolName}: 0 known dependents. Safe to modify.` };
  }

  const formatted = callers.map(c => `- ${c.kind} ${c.name} (${c.path})`).join('\n');
  return { result: `Blast Radius for ${symbolName}: ${callers.length} dependents.\n\nDependents:\n${formatted}` };
}
