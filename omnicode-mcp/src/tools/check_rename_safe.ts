import { initDb } from '../store/db';

export async function checkRenameSafe(repoPath: string, currentName: string, newName: string) {
  const db = initDb(repoPath);

  // Check if current name exists
  const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ?`).get(currentName) as any;
  if (!targetSymbol) {
    return { result: `Symbol '${currentName}' not found. Cannot rename.` };
  }

  // Check if new name causes collisions in the index
  const collisions = db.prepare(`SELECT name, kind, file_id FROM symbols WHERE name = ? COLLATE NOCASE`).all(newName) as any[];

  if (collisions.length > 0) {
    let report = `Warning! Renaming '${currentName}' to '${newName}' is risky and will cause collisions with existing symbols:\n`;
    for (const c of collisions) {
      const fileRow = db.prepare(`SELECT path FROM files WHERE id = ?`).get(c.file_id) as any;
      report += `- Conflict: [${c.kind}] ${c.name} in ${fileRow.path}\n`;
    }
    return { result: report };
  }

  // Find users
  const incoming = db.prepare(`SELECT from_symbol FROM edges WHERE to_symbol = ?`).all(targetSymbol.id) as any[];
  
  if (incoming.length === 0) {
    return { result: `Safe to rename. '${currentName}' has no dependencies and new name '${newName}' is available.` };
  }

  return { result: `Safe to rename, but requires updating ${incoming.length} dependents. New name '${newName}' does not collide with existing structural symbols.` };
}
