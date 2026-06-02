import { NextRequest, NextResponse } from "next/server";
import { hasPermission, Permission } from "@/lib/rbac";
import { logAudit } from "@/lib/audit";
import { getIdentity } from "@/lib/auth";
import { enforceAllowedRoot } from "../../../../omnicode-mcp/src/security/sandbox";

export async function GET(req: NextRequest) {
  // EventSource cannot send Authorization headers, but it DOES send the
  // same-origin session cookie set by /api/auth/login — getIdentity reads both.
  const id = getIdentity(req);
  if (!id) {
    await logAudit({ user: "anonymous", role: "unknown", action: "index:code", details: "Unauthenticated index request rejected.", outcome: "failure" });
    return new NextResponse("Unauthorized", { status: 401 });
  }

  if (!hasPermission(id.role, Permission.IndexCode)) {
    await logAudit({ user: id.user, role: id.role, action: "index:code", details: "Access denied: Insufficient permissions to index codebase.", outcome: "failure" });
    return new NextResponse("Forbidden", { status: 403 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const rawPath = req.nextUrl.searchParams.get("path");
        const repoPath = rawPath ? rawPath.trim() : process.cwd();
        enforceAllowedRoot(repoPath);
        const { indexProject } = await import("../../../../omnicode-mcp/src/tools/index_project");

        const result = await indexProject(repoPath, (current: number, total: number) => {
          const payload = JSON.stringify({ progress: current, total });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        });

        await logAudit({ user: id.user, role: id.role, action: "index:code", details: `Indexed via tree-sitter. Graph built.`, outcome: "success" });
        const finalPayload = JSON.stringify({ done: true, result });
        controller.enqueue(encoder.encode(`data: ${finalPayload}\n\n`));
        controller.close();
      } catch (error: any) {
        await logAudit({ user: id.user, role: id.role, action: "index:code", details: `Indexing failed: ${error.message}`, outcome: "failure" });
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: error.message })}\n\n`));
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
