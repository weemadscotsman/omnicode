import { initDb } from '../store/db';
import { spawnSync } from 'child_process';
import path from 'path';

export async function getChurnRate(repoPath: string, symbolName: string) {
  const db = initDb(repoPath);

  const targetSymbol = db.prepare(`SELECT * FROM symbols WHERE name = ? COLLATE NOCASE`).get(symbolName) as any;
  if (!targetSymbol) {
    return { result: `Symbol '${symbolName}' not found in index.` };
  }

  const fileRow = db.prepare(`SELECT path FROM files WHERE id = ?`).get(targetSymbol.file_id) as any;
  if (!fileRow) {
    return { result: `File for symbol '${symbolName}' not found.` };
  }

  let gitOutput = '';
  try {
    const lineRef = `${targetSymbol.line},${targetSymbol.line}:${fileRow.path}`;
    const r = spawnSync('git', ['log', `-L${lineRef}`, '--oneline'], {
      cwd: repoPath,
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout) {
      gitOutput = r.stdout;
    } else {
      throw new Error(r.stderr || 'non-zero exit');
    }
  } catch (err: any) {
    // fallback to generic file churn
    const r = spawnSync('git', ['log', '--oneline', fileRow.path], {
      cwd: repoPath,
      encoding: 'utf8',
    });
    if (r.status === 0 && r.stdout) {
      gitOutput = r.stdout;
    } else {
      return { result: `Cannot access git churn for ${fileRow.path}. Make sure it is tracked by git.` };
    }
  }
  
  const commitCount = gitOutput.split('\n').filter(line => line.match(/^[a-f0-9]{7,40} /i)).length;
  
  const risk = commitCount > 20 ? "HIGH RISK (Constant Churn)" : commitCount > 5 ? "MODERATE RISK" : "STABLE";
  
  return { result: `Symbol '${symbolName}' in ${fileRow.path} has been modified in approximately ${commitCount} commits.\nMaintenance status: ${risk}` };
}
