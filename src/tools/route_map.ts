import { initDb } from '../store/db';

export async function routeMap(repoPath: string) {
  const db = initDb(repoPath);

  const routeFiles = db.prepare(`
    SELECT id, path FROM files 
    WHERE path LIKE '%/app/%/route.ts' OR path LIKE '%/app/%/page.tsx' OR path LIKE '%/pages/%' OR path LIKE '%routes%' 
  `).all() as any[];

  if (routeFiles.length === 0) {
    return { result: "No Next.js app/pages or general route definitions detected." };
  }

  let formatted = "Route Map (Endpoints & Pages):\n";
  for (const f of routeFiles) {
    const rel = f.path.replace(repoPath, '');
    
    // Look up default exports or HTTP handlers
    const symbols = db.prepare(`
      SELECT name, kind, line FROM symbols WHERE file_id = ? AND (name IN ('GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'default') OR name LIKE '%Router%' OR name LIKE '%Controller%')
    `).all(f.id) as any[];

    if (symbols.length > 0) {
      formatted += `- ${rel}\n`;
      for (const s of symbols) {
        formatted += `    Line ${s.line}: [${s.kind}] ${s.name}\n`;
      }
    } else {
      formatted += `- ${rel} (No specific route handler symbols extracted)\n`;
    }
  }

  return { result: formatted };
}
