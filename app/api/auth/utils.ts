import { createHmac, timingSafeEqual } from "node:crypto";

// No insecure fallback: if the real secret isn't configured, refuse to sign
// or verify rather than falling back to a value visible in the source, which
// would let anyone forge a cookie for any email (including the admin).
function getSecret(): string {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY is not configured; cannot sign or verify the auth cookie.");
  return secret;
}

export function signEmailCookie(email: string): string {
  const hmac = createHmac("sha256", getSecret());
  hmac.update(email);
  const signature = hmac.digest("hex");
  return `${email}:${signature}`;
}

export function verifyEmailCookie(cookieValue: string | undefined | null): string | null {
  if (!cookieValue) return null;
  const separatorIndex = cookieValue.lastIndexOf(":");
  if (separatorIndex < 0) return null;
  const email = cookieValue.slice(0, separatorIndex);
  const signature = cookieValue.slice(separatorIndex + 1);

  let expectedSignature: string;
  try {
    const hmac = createHmac("sha256", getSecret());
    hmac.update(email);
    expectedSignature = hmac.digest("hex");
  } catch {
    return null;
  }

  const signatureBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  return email;
}

export function isEmailAuthorized(email: string | null): boolean {
  if (!email) return false;
  
  // If the user specified exact authorized emails in .env, use them
  if (process.env.AUTHORIZED_EMAILS) {
    const allowed = process.env.AUTHORIZED_EMAILS.split(",").map(e => e.trim().toLowerCase());
    return allowed.includes(email.toLowerCase());
  }
  
  // Otherwise default to the organizational domains
  const domain = email.split("@")[1]?.toLowerCase();
  return domain === "ikf.co.in" || domain === "iknowai.in";
}
