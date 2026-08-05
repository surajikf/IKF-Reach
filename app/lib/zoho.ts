import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ZOHO_SETTING_KEY = "zoho_oauth";
const ZOHO_ACCOUNTS_BASE = "https://accounts.zoho.in";
const DEFAULT_ZOHO_MAIL_API_BASE = "https://mail.zoho.in/api";
const DEFAULT_ZOHO_SCOPES = "ZohoMail.accounts.READ,ZohoMail.messages.ALL";

type EncryptedSecret = {
  version: 1;
  iv: string;
  tag: string;
  value: string;
};

type StoredZohoConnection = {
  version: 1;
  connected: true;
  accountId: string;
  email: string;
  apiBase: string;
  scopes: string;
  accessToken: EncryptedSecret;
  refreshToken: EncryptedSecret;
  expiresAt: string;
  connectedAt: string;
  updatedAt: string;
  connectedBy: string;
};

type ZohoTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  api_domain?: string;
  error?: string;
};

type ZohoApiResponse = {
  data?: unknown;
  status?: unknown;
  message?: unknown;
  error?: unknown;
  [key: string]: unknown;
};

function supabaseUrl() {
  return process.env.SUPABASE_URL || "";
}

function supabaseKey() {
  return process.env.SUPABASE_SECRET_KEY || "";
}

function encryptionKey() {
  const source = process.env.ZOHO_TOKEN_ENCRYPTION_KEY || supabaseKey();
  if (!source) throw new Error("ZOHO_TOKEN_ENCRYPTION_KEY or SUPABASE_SECRET_KEY is required to protect Zoho tokens.");
  return createHash("sha256").update(source).digest();
}

function encryptSecret(value: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    version: 1,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    value: encrypted.toString("base64url"),
  };
}

function decryptSecret(secret: EncryptedSecret) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(secret.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(secret.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(secret.value, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function settingsRequest(path: string, init: RequestInit = {}) {
  if (!supabaseUrl() || !supabaseKey()) throw new Error("Supabase server credentials are not configured.");
  const response = await fetch(`${supabaseUrl()}/rest/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: supabaseKey(),
      Authorization: `Bearer ${supabaseKey()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Unable to save Zoho connection (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : [];
}

export function getZohoOAuthConfig() {
  const clientId = process.env.ZOHO_CLIENT_ID || "";
  const clientSecret = process.env.ZOHO_CLIENT_SECRET || "";
  return {
    clientId,
    clientSecret,
    accountsBase: process.env.ZOHO_ACCOUNTS_BASE || ZOHO_ACCOUNTS_BASE,
    apiBase: process.env.ZOHO_MAIL_API_BASE || DEFAULT_ZOHO_MAIL_API_BASE,
    scopes: process.env.ZOHO_OAUTH_SCOPES || DEFAULT_ZOHO_SCOPES,
    preferredMailbox: (process.env.ZOHO_MAILBOX_EMAIL || process.env.BREVO_SENDER_EMAIL || "tanishka@iknowai.in").toLowerCase(),
    configured: Boolean(clientId && clientSecret && supabaseUrl() && supabaseKey()),
  };
}

export function getZohoRedirectUri(request: Request) {
  if (process.env.ZOHO_REDIRECT_URI) return process.env.ZOHO_REDIRECT_URI;
  const url = new URL(request.url);
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const protocol = forwardedProto || url.protocol.replace(":", "");
  const host = forwardedHost || request.headers.get("host") || url.host;
  return `${protocol}://${host}/api/auth/zoho/callback`;
}

export async function exchangeZohoAuthorizationCode(code: string, redirectUri: string) {
  const config = getZohoOAuthConfig();
  if (!config.configured) throw new Error("Zoho OAuth is not configured.");
  const response = await fetch(`${config.accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUri,
      code,
    }),
  });
  const payload = await response.json() as ZohoTokenResponse;
  if (!response.ok || !payload.access_token) throw new Error(payload.error || "Zoho did not return an access token.");
  return payload;
}

function accountEmail(account: Record<string, unknown>) {
  const direct = account.primaryEmailAddress || account.emailAddress || account.email;
  if (typeof direct === "string" && direct.includes("@")) return direct.toLowerCase();
  const addresses = account.emailAddresses;
  if (Array.isArray(addresses)) {
    const value = addresses.find((item) => typeof item === "string" && item.includes("@"));
    if (typeof value === "string") return value.toLowerCase();
  }
  return "";
}

export async function resolveZohoMailAccount(accessToken: string) {
  const config = getZohoOAuthConfig();
  const response = await fetch(`${config.apiBase}/accounts`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
    cache: "no-store",
  });
  const payload = await response.json() as { data?: Array<Record<string, unknown>>; accounts?: Array<Record<string, unknown>>; message?: string };
  if (!response.ok) throw new Error(payload.message || "Zoho Mail account lookup failed.");
  const accounts = payload.data || payload.accounts || [];
  if (!accounts.length) throw new Error("No Zoho Mail account is available for this login.");
  const account = accounts.find((item) => accountEmail(item) === config.preferredMailbox) || accounts[0];
  const accountId = String(account.accountId || account.id || "");
  const email = accountEmail(account) || config.preferredMailbox;
  if (!accountId) throw new Error("Zoho Mail did not return an account ID.");
  return { accountId, email };
}

async function readStoredConnection() {
  const rows = await settingsRequest(`outreach_settings?select=value&key=eq.${encodeURIComponent(ZOHO_SETTING_KEY)}&limit=1`);
  return (rows[0]?.value || null) as StoredZohoConnection | null;
}

async function writeStoredConnection(connection: StoredZohoConnection) {
  await settingsRequest("outreach_settings?on_conflict=key", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ key: ZOHO_SETTING_KEY, value: connection, updated_by: connection.connectedBy, updated_at: connection.updatedAt }),
  });
}

export async function saveZohoConnection(input: {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string;
  accountId: string;
  email: string;
  connectedBy: string;
}) {
  const existing = await readStoredConnection();
  const refreshToken = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : existing?.refreshToken;
  if (!refreshToken) throw new Error("Zoho did not provide a refresh token. Reconnect with consent enabled.");
  const now = new Date();
  const config = getZohoOAuthConfig();
  const connection: StoredZohoConnection = {
    version: 1,
    connected: true,
    accountId: input.accountId,
    email: input.email.toLowerCase(),
    apiBase: config.apiBase,
    scopes: input.scopes || config.scopes,
    accessToken: encryptSecret(input.accessToken),
    refreshToken,
    expiresAt: new Date(now.getTime() + Math.max(60, input.expiresIn || 3600) * 1000).toISOString(),
    connectedAt: existing?.connectedAt || now.toISOString(),
    updatedAt: now.toISOString(),
    connectedBy: input.connectedBy,
  };
  await writeStoredConnection(connection);
  return connection;
}

export async function getZohoConnectionStatus() {
  const config = getZohoOAuthConfig();
  if (!config.configured) return { configured: false, connected: false, email: null, accountId: null, expiresAt: null, connectedAt: null, error: null };
  try {
    const stored = await readStoredConnection();
    return {
      configured: true,
      connected: Boolean(stored?.connected && stored?.refreshToken),
      email: stored?.email || null,
      accountId: stored?.accountId || null,
      expiresAt: stored?.expiresAt || null,
      connectedAt: stored?.connectedAt || null,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      email: null,
      accountId: null,
      expiresAt: null,
      connectedAt: null,
      error: error instanceof Error ? error.message : "Unable to read Zoho connection.",
    };
  }
}

export async function getValidZohoAccessToken() {
  const stored = await readStoredConnection();
  if (!stored?.refreshToken) throw new Error("Zoho Mail is not connected.");
  if (stored.accessToken && new Date(stored.expiresAt).getTime() > Date.now() + 90_000) {
    return { accessToken: decryptSecret(stored.accessToken), accountId: stored.accountId, email: stored.email, apiBase: stored.apiBase };
  }

  const config = getZohoOAuthConfig();
  const response = await fetch(`${config.accountsBase}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: decryptSecret(stored.refreshToken),
    }),
  });
  const payload = await response.json() as ZohoTokenResponse;
  if (!response.ok || !payload.access_token) throw new Error(payload.error || "Zoho access-token refresh failed.");
  const updated: StoredZohoConnection = {
    ...stored,
    accessToken: encryptSecret(payload.access_token),
    expiresAt: new Date(Date.now() + Math.max(60, payload.expires_in || 3600) * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeStoredConnection(updated);
  return { accessToken: payload.access_token, accountId: stored.accountId, email: stored.email, apiBase: stored.apiBase };
}

function zohoMessageId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  for (const key of ["messageId", "messageID", "id"]) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  if (Array.isArray(value.data)) {
    for (const item of value.data) {
      const id = zohoMessageId(item);
      if (id) return id;
    }
  } else if (value.data) {
    const id = zohoMessageId(value.data);
    if (id) return id;
  }
  return null;
}

async function zohoMessageRequest(path: string, body: Record<string, unknown>) {
  const connection = await getValidZohoAccessToken();
  const response = await fetch(`${connection.apiBase}/accounts/${encodeURIComponent(connection.accountId)}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${connection.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await response.text();
  let payload: ZohoApiResponse = {};
  try {
    payload = text ? JSON.parse(text) as ZohoApiResponse : {};
  } catch {
    payload = { message: text };
  }
  if (!response.ok) {
    const detail = typeof payload.message === "string" ? payload.message : typeof payload.error === "string" ? payload.error : text;
    throw new Error(`Zoho Mail request failed (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  return { payload, messageId: zohoMessageId(payload) };
}

export async function sendZohoMessage(input: {
  toAddress: string;
  subject: string;
  html: string;
  fromAddress?: string;
}) {
  const connection = await getValidZohoAccessToken();
  return zohoMessageRequest("/messages", {
    fromAddress: input.fromAddress || connection.email,
    toAddress: input.toAddress,
    subject: input.subject,
    content: input.html,
    mailFormat: "html",
    encoding: "UTF-8",
    isSchedule: false,
  });
}

export async function replyZohoMessage(input: {
  messageId: string;
  toAddress: string;
  subject: string;
  html: string;
  fromAddress?: string;
}) {
  const connection = await getValidZohoAccessToken();
  return zohoMessageRequest(`/messages/${encodeURIComponent(input.messageId)}`, {
    fromAddress: input.fromAddress || connection.email,
    toAddress: input.toAddress,
    subject: /^re:\s*/i.test(input.subject) ? input.subject : `Re: ${input.subject}`,
    content: input.html,
    action: "reply",
    mailFormat: "html",
    encoding: "UTF-8",
    isSchedule: false,
  });
}

export async function disconnectZoho() {
  await settingsRequest(`outreach_settings?key=eq.${encodeURIComponent(ZOHO_SETTING_KEY)}`, { method: "DELETE" });
}
