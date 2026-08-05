import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getManagementAccess } from "../../../lib/manage-access";
import { getZohoOAuthConfig, getZohoRedirectUri } from "../../../lib/zoho";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await getManagementAccess(request);
  if (!access.allowed) return NextResponse.redirect(new URL("/?zoho=unauthorized", request.url));

  const config = getZohoOAuthConfig();
  if (!config.configured) return NextResponse.redirect(new URL("/?zoho=misconfigured", request.url));

  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL(`${config.accountsBase}/oauth/v2/auth`);
  authorizationUrl.searchParams.set("client_id", config.clientId);
  authorizationUrl.searchParams.set("redirect_uri", getZohoRedirectUri(request));
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", config.scopes);
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizationUrl.toString());
  response.cookies.set("zoho_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 10 * 60,
    path: "/",
  });
  return response;
}

