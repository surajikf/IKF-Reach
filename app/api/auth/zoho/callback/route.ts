import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getManagementAccess } from "../../../../lib/manage-access";
import {
  exchangeZohoAuthorizationCode,
  getZohoRedirectUri,
  resolveZohoMailAccount,
  saveZohoConnection,
} from "../../../../lib/zoho";

export const dynamic = "force-dynamic";

function safeStateMatch(received: string | null, expected: string | undefined) {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function redirectWithStatus(request: NextRequest, status: string) {
  const response = NextResponse.redirect(new URL(`/?zoho=${encodeURIComponent(status)}`, request.url));
  response.cookies.set("zoho_oauth_state", "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}

export async function GET(request: NextRequest) {
  const error = request.nextUrl.searchParams.get("error");
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (error) return redirectWithStatus(request, "denied");
  if (!code || !safeStateMatch(state, request.cookies.get("zoho_oauth_state")?.value)) {
    return redirectWithStatus(request, "invalid-state");
  }

  const access = await getManagementAccess(request);
  if (!access.allowed) return redirectWithStatus(request, "unauthorized");

  try {
    const tokens = await exchangeZohoAuthorizationCode(code, getZohoRedirectUri(request));
    const account = await resolveZohoMailAccount(tokens.access_token!);
    await saveZohoConnection({
      accessToken: tokens.access_token!,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scopes: tokens.scope,
      accountId: account.accountId,
      email: account.email,
      connectedBy: access.email || "approved-user",
    });
    return redirectWithStatus(request, "connected");
  } catch (error) {
    console.error("Zoho OAuth callback failed:", error instanceof Error ? error.message : "Unknown error");
    return redirectWithStatus(request, "failed");
  }
}

