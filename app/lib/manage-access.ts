import type { NextRequest } from "next/server";
import { getQueueDb } from "../../db";
import { verifyEmailCookie } from "../api/auth/utils";

const allowedOperators = new Set(["gpt@ikf.co.in", "social@ikf.co.in"]);

function isLocalRequest(request: NextRequest) {
  const host = (request.headers.get("host") || "").toLowerCase();
  return host.includes("localhost") || host.includes("127.0.0.1");
}

export async function getManagementAccess(request: NextRequest) {
  const workspaceEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase() || "";
  if (allowedOperators.has(workspaceEmail)) return { allowed: true, email: workspaceEmail };

  const configuredAccessKey = process.env.IKF_ACCESS_KEY || process.env.NEXT_PUBLIC_TEAM_ACCESS_KEY || "";
  const suppliedAccessKey = request.headers.get("x-ikf-access-key") || "";
  if (configuredAccessKey && suppliedAccessKey === configuredAccessKey) {
    return { allowed: true, email: "access-key-user" };
  }

  const sessionEmail = verifyEmailCookie(request.cookies.get("ikf_auth")?.value)?.toLowerCase() || "";
  if (sessionEmail === "suraj.sonnar@ikf.co.in" || sessionEmail === process.env.ADMIN_EMAIL?.toLowerCase()) {
    return { allowed: true, email: sessionEmail };
  }

  if (sessionEmail) {
    const user = await getQueueDb()
      .prepare("SELECT status FROM app_users WHERE email = ?")
      .bind(sessionEmail)
      .first<{ status: string }>();
    if (user?.status === "approved") return { allowed: true, email: sessionEmail };
  }

  if (isLocalRequest(request)) return { allowed: true, email: sessionEmail || "local-development" };
  return { allowed: false, email: sessionEmail || workspaceEmail || null };
}

