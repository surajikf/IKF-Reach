import { NextRequest, NextResponse } from "next/server";
import { getManagementAccess } from "../../../lib/manage-access";
import { disconnectZoho, getZohoConnectionStatus, getZohoRedirectUri } from "../../../lib/zoho";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Authorized IKF access is required." }, { status: 403 });
  const status = await getZohoConnectionStatus();
  return NextResponse.json({ ok: true, ...status, redirectUri: getZohoRedirectUri(request) });
}

export async function DELETE(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.json({ ok: false, error: "Authorized IKF access is required." }, { status: 403 });
  await disconnectZoho();
  return NextResponse.json({ ok: true, connected: false });
}

