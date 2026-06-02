import { initDb } from '../store/db';
import { getChurnRate } from './get_churn_rate';

export async function getHotspots(repoPath: string, limit: number = 10) {
  const db = initDb(repoPath);

  const topHubs = db.prepare(`
    SELECT s.name, s.kind, f.path, s.importance_score
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    ORDER BY s.importance_score DESC
    LIMIT ?
  `).all(limit * 2) as any[]; // Get slightly more to rank by combined risk if possible, but keep simple for now

  if (topHubs.length === 0) {
    return { result: "No hotspots found in the repository." };
  }

  // Resolve churn for each
  const hotspotsData = [];
  for (const hub of topHubs) {
    const churnRes = await getChurnRate(repoPath, hub.name);
    // Parse commit count roughly from the string
    const match = churnRes.result.match(/approximately (\d+) commits/);
    const commits = match ? parseInt(match[1], 10) : 0;
    
    // Risk score = importance_score + (commits * 5)
    const riskScore = (hub.importance_score || 0) + (commits * 5);
    hotspotsData.push({
      ...hub,
      commits,
      riskScore
    });
  }
  
  hotspotsData.sort((a, b) => b.riskScore - a.riskScore);
  const finalHubs = hotspotsData.slice(0, limit);

  let result = `Top ${limit} Architectural Hotspots (High Risk & High Importance):\n`;
  result += `Ranked by Combined Risk Score (Importance Score + Git Churn)\n\n`;
  for (let i = 0; i < finalHubs.length; i++) {
    const hub = finalHubs[i];
    result += `${i + 1}. [${hub.kind}] ${hub.name} in ${hub.path}\n`;
    result += `    Importance: ${hub.importance_score} | Git Churn: ${hub.commits} recent commits | Risk Score: ${hub.riskScore}\n`;
  }

  return { result };
}
