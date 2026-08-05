import { NextRequest, NextResponse } from "next/server";
import { processDueFollowups } from "../../lib/followups";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const expected = process.env.SUPABASE_SECRET_KEY || "";
  const host = (request.headers.get("host") || "").toLowerCase();
  return host.includes("localhost") || host.includes("127.0.0.1") || (Boolean(expected) && request.headers.get("x-ikf-followup-token") === expected);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Follow-up worker authorization failed." }, { status: 403 });
  try {
    const result = await processDueFollowups(10);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Follow-up worker failed." }, { status: 500 });
  }
}
