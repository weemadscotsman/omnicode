import { NextRequest, NextResponse } from "next/server";
import { hasPermission, Permission } from "@/lib/rbac";
import { logAudit, getAuditLogs, verifyAuditChain } from "@/lib/audit";
import { getIdentity } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const id = getIdentity(req);
  if (!id) {
    await logAudit({ user: "anonymous", role: "unknown", action: "view:logs", details: "Unauthenticated request rejected.", outcome: "failure" });
    return NextResponse.json({ error: "Unauthorized: authenticate via /api/auth/login or a Bearer key." }, { status: 401 });
  }

  if (!hasPermission(id.role, Permission.ViewLogs)) {
    await logAudit({ user: id.user, role: id.role, action: "view:logs", details: "Access denied. Admin access required to view audit logs.", outcome: "failure" });
    return NextResponse.json({ error: "Forbidden: Only Admin role can view logs." }, { status: 403 });
  }

  await logAudit({ user: id.user, role: id.role, action: "view:logs", details: "Viewed the audit log trace.", outcome: "success" });
  const [logs, integrity] = await Promise.all([getAuditLogs(), verifyAuditChain()]);
  return NextResponse.json({ logs, integrity });
}
