import { initDb } from '../store/db';

export async function deadCodeScan(repoPath: string) {
  const db = initDb(repoPath);
  
  const symbols = db.prepare(`
    SELECT s.name, s.kind, f.path, 
           (SELECT COUNT(*) FROM edges e WHERE e.to_symbol = s.id) as incoming_edges,
           s.importance_score
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE s.name NOT IN ('default', 'main', 'index', 'App', 'Layout')
  `).all() as any[];

  const dead: any[] = [];
  const sleeping: any[] = [];

  for (const s of symbols) {
     let fileImportance = 5;
     if (s.path.includes('test') || s.path.includes('spec')) fileImportance = 1;
     else if (s.path.includes('utils') || s.path.includes('helpers')) fileImportance = 3;
     else if (s.path.includes('core') || s.path.includes('engine')) fileImportance = 8;
     
     s.usage_score = (s.importance_score || 0) + fileImportance;

     if (s.incoming_edges === 0) {
        dead.push(s);
     } else if (s.incoming_edges <= 1 || s.usage_score < 15) {
        sleeping.push(s);
     }
  }

  sleeping.sort((a, b) => a.usage_score - b.usage_score);

  if (dead.length === 0 && sleeping.length === 0) {
    return { result: `No dead or sleeping code detected.` };
  }

  let formatted = "Prioritized Cleanup Report:\n\n";

  if (dead.length > 0) {
    formatted += `--- DEAD SYMBOLS (0 incoming edges) - Top ${Math.min(dead.length, 50)} of ${dead.length} ---\n`;
    formatted += dead.slice(0, 50).map(s => `- [${s.kind}] ${s.name} (${s.path})`).join('\n') + "\n\n";
  }

  if (sleeping.length > 0) {
    formatted += `--- SLEEPING SYMBOLS (Low usage / score) - Top ${Math.min(sleeping.length, 50)} of ${sleeping.length} ---\n`;
    formatted += sleeping.slice(0, 50).map(s => `- [${s.kind}] ${s.name} (Score: ${s.usage_score.toFixed(1)}) (${s.path})`).join('\n') + "\n\n";
  }

  return { result: formatted.trim() };
}
