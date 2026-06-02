import { initDb } from '../store/db';

export async function testMap(repoPath: string) {
  const db = initDb(repoPath);

  const testFiles = db.prepare(`
    SELECT id, path FROM files 
    WHERE path LIKE '%/test/%' OR path LIKE '%.test.%' OR path LIKE '%.spec.%' OR path LIKE '%.e2e.%'
  `).all() as any[];

  if (testFiles.length === 0) {
    return { result: "No test files detected in the index." };
  }

  let formatted = "Test Map (Locate test files globally):\n";
  for (const f of testFiles) {
    const rel = f.path.replace(repoPath, '');
    
    // Attempt to parse describe/it blocks usually treated as calls if extracted, but typically test symbols might be just call expressions.
    // We'll just list the test locations for now.
    formatted += `- ${rel}\n`;
  }

  return { result: formatted };
}
