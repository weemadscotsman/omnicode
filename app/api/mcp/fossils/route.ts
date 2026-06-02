import { NextRequest, NextResponse } from "next/server";
import { hasPermission, Permission } from "@/lib/rbac";
import { getIdentity } from "@/lib/auth";
import { loadGoopGraph } from "@/lib/goopmunch";

export async function GET(req: NextRequest) {
  const id = getIdentity(req);
  if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasPermission(id.role, Permission.SearchSymbols)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const graph = await loadGoopGraph();
  if (!graph) return NextResponse.json({ fossils: [] });

  const fossils = Object.values(graph.symbols).filter((s) => ['dead', 'sleeping'].includes(s.fossilStatus));
  fossils.sort((a, b) => a.goopScore - b.goopScore);

  return NextResponse.json({ fossils });
}
