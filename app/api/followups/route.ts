import { NextRequest, NextResponse } from "next/server";
import { getManagementAccess } from "../../lib/manage-access";
import { approveFollowup, createFollowupSequence, dueFollowupIds, listFollowups, stopFollowup, syncCampaignThreads } from "../../lib/followups";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Authorized IKF access is required." }, { status: 403 });
  try {
    if (request.nextUrl.searchParams.get("dueOnly") === "1") return NextResponse.json({ ok: true, sequenceIds: await dueFollowupIds() });
    const campaignId = request.nextUrl.searchParams.get("campaignId") || undefined;
    return NextResponse.json({ ok: true, sequences: await listFollowups(campaignId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to load follow-ups." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Authorized IKF access is required." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, any>;
    const action = String(body.action || "");
    if (action === "sync_threads") return NextResponse.json({ ok: true, ...(await syncCampaignThreads(String(body.campaignId || ""), Number(body.limit || 25))) });
    if (action === "create") return NextResponse.json({ ok: true, ...(await createFollowupSequence({ campaignId: String(body.campaignId || ""), name: String(body.name || "Follow-up sequence"), excludeReplied: body.excludeReplied !== false, stages: Array.isArray(body.stages) ? body.stages : [], actor: access.email || "authorized-user" })) });
    if (action === "approve") { await approveFollowup(String(body.sequenceId || ""), body.scheduledFor || null); return NextResponse.json({ ok: true }); }
    if (action === "stop") { await stopFollowup(String(body.sequenceId || "")); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ ok: false, error: "Unknown follow-up action." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Follow-up action failed." }, { status: 500 });
  }
}
