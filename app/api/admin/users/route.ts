import { NextRequest, NextResponse } from "next/server";
import { getQueueDb } from "../../../../db";
import { verifyEmailCookie } from "../../auth/utils";

async function checkAdmin(req: NextRequest) {
  const authCookie = req.cookies.get("ikf_auth")?.value;
  const email = verifyEmailCookie(authCookie);
  if (!email) return false;

  if (email.toLowerCase() === "suraj.sonnar@ikf.co.in") return true;

  const db = getQueueDb();
  const user = await db.prepare("SELECT role FROM app_users WHERE email = ?").bind(email.toLowerCase()).first<{ role: string }>();
  return Boolean(user && user.role === "admin");
}

export async function GET(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const db = getQueueDb();
  const { results } = await db.prepare("SELECT email, status, role, created_at as createdAt FROM app_users ORDER BY created_at DESC").all();

  return NextResponse.json({ ok: true, users: results });
}

export async function PUT(req: NextRequest) {
  if (!(await checkAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const { email, status } = await req.json();
    if (!email || !status) {
      return NextResponse.json({ error: "Missing email or status" }, { status: 400 });
    }

    if (!["pending", "approved", "rejected"].includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const db = getQueueDb();
    await db.prepare("UPDATE app_users SET status = ? WHERE email = ?").bind(status, email.toLowerCase()).run();

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || "Failed to update user" }, { status: 500 });
  }
}
