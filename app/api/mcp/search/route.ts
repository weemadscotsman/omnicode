import { NextRequest, NextResponse } from "next/server";
import { hasPermission, Permission } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { getIdentity } from "@/lib/auth";
import { initDb } from "../../../../omnicode-mcp/src/store/db";
import { enforceAllowedRoot } from "../../../../omnicode-mcp/src/security/sandbox";

export async function POST(req: NextRequest) {
  const id = getIdentity(req);
  if (!id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { query, path: rawPath } = await req.json();
  const repoPath = rawPath ? String(rawPath).trim() : process.cwd();
  try { enforceAllowedRoot(repoPath); } catch {
    return NextResponse.json({ error: "Forbidden: path outside allowed roots" }, { status: 403 });
  }

  if (!hasPermission(id.role, Permission.SearchSymbols)) {
    await logAudit({ user: id.user, role: id.role, action: "search:symbols", details: `Access denied. Denied search for '${query}'.`, outcome: "failure" });
    return NextResponse.json({ error: "Forbidden: You do not have permission to search." }, { status: 403 });
  }

  const db = initDb(repoPath);
  const q = String(query || "").trim();
  const rows = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.kind,
      s.line,
      f.path AS file,
      COALESCE(s.goop_score, s.importance_score, 0) AS goopScore
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE
      @query = ''
      OR LOWER(s.name) LIKE @pattern
      OR LOWER(f.path) LIKE @pattern
    ORDER BY COALESCE(s.importance_score, 0) DESC, COALESCE(s.goop_score, 0) DESC, s.name ASC
    LIMIT 50
  `).all({
    query: q.toLowerCase(),
    pattern: `%${q.toLowerCase().replace(/[%_]/g, "\\$&")}%`,
  }) as Array<{ id: string; name: string; kind: string; line: number; file: string; goopScore: number }>;

  if (rows.length === 0) {
    const count = db.prepare(`SELECT COUNT(*) AS count FROM symbols`).get() as { count: number };
    const message = count.count === 0 ? "No symbols indexed yet. Run the indexer first." : "No symbols found matching query.";
    return NextResponse.json({ results: [], message });
  }

  await logAudit({ user: id.user, role: id.role, action: "search:symbols", details: `Searched for symbol matching: '${query}'`, outcome: "success" });
  return NextResponse.json({ results: rows });
}
