import { NextResponse } from "next/server";
import { signEmailCookie } from "../../utils";
import { getQueueDb } from "../../../../../db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.Client_ID || process.env.CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || process.env.Client_secret || process.env.CLIENT_SECRET;

  if (error || !code) {
    return NextResponse.redirect(new URL("/?auth=failed", request.url));
  }

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL("/?auth=misconfigured", request.url));
  }

  const redirectUri = `${url.protocol}//${url.host}/api/auth/google/callback`;

  try {
    // 1. Exchange the code for an access token
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error("Google Auth Token Error:", tokenData);
      return NextResponse.redirect(new URL("/?auth=failed", request.url));
    }

    // 2. Fetch the user's profile info (email)
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const profileData = await profileResponse.json();

    if (!profileResponse.ok || !profileData.email) {
      console.error("Google Auth Profile Error:", profileData);
      return NextResponse.redirect(new URL("/?auth=failed", request.url));
    }

    const email = profileData.email.toLowerCase();

    const db = getQueueDb();

    // Check if user exists
    const user = await db.prepare("SELECT * FROM app_users WHERE email = ?").bind(email).first();

    if (!user) {
      // Create new user
      const isAdmin = email === "suraj.sonnar@ikf.co.in" || email === process.env.ADMIN_EMAIL;
      const status = isAdmin ? "approved" : "pending";
      const role = isAdmin ? "admin" : "user";
      const now = new Date().toISOString();

      await db.prepare(
        "INSERT INTO app_users (email, status, role, created_at) VALUES (?, ?, ?, ?)"
      ).bind(email, status, role, now).run();
    }

    // Set the secure authentication cookie
    const response = NextResponse.redirect(new URL("/", request.url));
    
    // We sign the cookie to prevent tampering
    const cookieValue = signEmailCookie(email);
    
    response.cookies.set("ikf_auth", cookieValue, {
      httpOnly: false, // Accessible to client-side JS so we know who is logged in
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;

  } catch (err) {
    console.error("Google Auth Exception:", err);
    return NextResponse.redirect(new URL("/?auth=failed", request.url));
  }
}
