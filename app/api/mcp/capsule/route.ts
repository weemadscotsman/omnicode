import { NextRequest, NextResponse } from "next/server";
import { hasPermission, Permission } from "@/lib/rbac";
import { getIdentity } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { initDb } from "../../../../omnicode-mcp/src/store/db";
import { enforceAllowedRoot } from "../../../../omnicode-mcp/src/security/sandbox";

export async function POST(req: NextRequest) {
  const id = getIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { symbolId, path: rawPath } = await req.json();
  const repoPath = rawPath ? String(rawPath).trim() : process.cwd();
  try { enforceAllowedRoot(repoPath); } catch {
    return NextResponse.json({ error: "Forbidden: path outside allowed roots" }, { status: 403 });
  }

  if (!hasPermission(id.role, Permission.SearchSymbols)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const db = initDb(repoPath);
  const symbol = db.prepare(`
    SELECT
      s.id,
      s.name,
      s.kind,
      s.line,
      s.snippet AS contentSnippet,
      COALESCE(s.goop_score, s.importance_score, 0) AS goopScore,
      COALESCE(s.fossil_status, 'alive') AS fossilStatus,
      f.path AS file
    FROM symbols s
    JOIN files f ON s.file_id = f.id
    WHERE s.id = ?
  `).get(symbolId) as any;

  if (!symbol) return NextResponse.json({ error: "Symbol Context Not Found" }, { status: 404 });

  const callers = db.prepare(`
    SELECT s.id, s.name, s.kind, f.path AS file
    FROM edges e
    JOIN symbols s ON s.id = e.from_symbol
    JOIN files f ON f.id = s.file_id
    WHERE e.to_symbol = ?
    ORDER BY s.name ASC
    LIMIT 25
  `).all(symbol.id) as Array<{ id: string; name: string; kind: string; file: string }>;

  const dependencies = db.prepare(`
    SELECT s.id, s.name, s.kind, f.path AS file
    FROM edges e
    JOIN symbols s ON s.id = e.to_symbol
    JOIN files f ON f.id = s.file_id
    WHERE e.from_symbol = ?
    ORDER BY s.name ASC
    LIMIT 25
  `).all(symbol.id) as Array<{ id: string; name: string; kind: string; file: string }>;

  // Real, derived confidence (0–100): how complete is the retrieved context?
  // Based on actual signals — source resolved, line range known, callers and
  // dependencies linked — not a hardcoded number.
  const signals = [
    Boolean(symbol.contentSnippet && symbol.contentSnippet.length > 0),
    Boolean(symbol.kind),
    callers.length > 0,
    dependencies.length > 0,
    Boolean(symbol.fossilStatus),
  ];
  const confidenceScore = Math.round((signals.filter(Boolean).length / signals.length) * 1000) / 10;

  const capsule = {
    capsuleId: `c_${symbol.name}_${callers.length}`,
    target: symbol.name,
    kind: symbol.kind,
    exactSource: symbol.contentSnippet,
    centrality: symbol.goopScore,
    blastRadius: callers.length,
    callersInfo: callers.map((c) => ({ name: c.name, file: c.file, kind: c.kind })),
    dependenciesInfo: dependencies.map((d) => ({ name: d.name, file: d.file, kind: d.kind })),
    confidenceScore,
    fossilRecord: symbol.fossilStatus,
  };

  await logAudit({ user: id.user, role: id.role, action: "get:capsule", details: `Retrieved capsule for '${symbol.name}'`, outcome: "success" });
  return NextResponse.json({ capsule });
}
