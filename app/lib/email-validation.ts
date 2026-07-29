export type EmailValidationVerdict = "valid" | "risky" | "invalid" | "unknown";

export type EmailHistorySignals = {
  hardBounce?: boolean;
  softBounce?: boolean;
  complaint?: boolean;
  unsubscribed?: boolean;
  delivered?: boolean;
};

export type EmailDomainSignals = {
  reachable: boolean | null;
  mxRecords?: string[];
  fallbackAddressRecord?: boolean;
  error?: string | null;
};

export type EmailValidationResult = {
  email: string;
  normalizedEmail: string;
  domain: string;
  verdict: EmailValidationVerdict;
  score: number;
  syntaxValid: boolean;
  domainReachable: boolean | null;
  roleBased: boolean;
  disposable: boolean;
  typoSuggestion: string | null;
  history: Required<EmailHistorySignals>;
  reasons: string[];
  mxRecords: string[];
};

const roleMailboxes = new Set([
  "admin", "billing", "careers", "contact", "customerservice", "enquiry",
  "enquiries", "hello", "help", "hr", "info", "jobs", "mail", "marketing",
  "office", "operations", "reception", "sales", "secretary", "support",
  "team", "webmaster",
]);

const disposableDomains = new Set([
  "10minutemail.com", "dispostable.com", "fakeinbox.com", "guerrillamail.com",
  "maildrop.cc", "mailinator.com", "mintemail.com", "sharklasers.com",
  "temp-mail.org", "tempmail.com", "throwawaymail.com", "yopmail.com",
]);

const commonDomainTypos: Record<string, string> = {
  "gamil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmial.com": "gmail.com",
  "gmail.co": "gmail.com",
  "hotmal.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "outllook.com": "outlook.com",
  "outlok.com": "outlook.com",
  "yaho.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
};

export function normalizeEmailAddress(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function isPracticalEmailSyntax(value: unknown) {
  const email = normalizeEmailAddress(value);
  if (!email || email.length > 254 || email.includes("..")) return false;
  const parts = email.split("@");
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !domain || domain.length > 253) return false;
  if (local.startsWith(".") || local.endsWith(".")) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) return false;
  return true;
}

export function emailDomain(value: unknown) {
  const email = normalizeEmailAddress(value);
  return email.includes("@") ? email.slice(email.lastIndexOf("@") + 1) : "";
}

export function isRoleMailbox(value: unknown) {
  const local = normalizeEmailAddress(value).split("@")[0]?.replace(/[._+-].*$/, "") || "";
  return roleMailboxes.has(local);
}

export function validateEmailSignals(
  value: unknown,
  domainSignals: EmailDomainSignals,
  historySignals: EmailHistorySignals = {},
): EmailValidationResult {
  const normalizedEmail = normalizeEmailAddress(value);
  const domain = emailDomain(normalizedEmail);
  const syntaxValid = isPracticalEmailSyntax(normalizedEmail);
  const roleBased = syntaxValid && isRoleMailbox(normalizedEmail);
  const disposable = disposableDomains.has(domain);
  const typoSuggestion = commonDomainTypos[domain] || null;
  const history = {
    hardBounce: Boolean(historySignals.hardBounce),
    softBounce: Boolean(historySignals.softBounce),
    complaint: Boolean(historySignals.complaint),
    unsubscribed: Boolean(historySignals.unsubscribed),
    delivered: Boolean(historySignals.delivered),
  };
  const reasons: string[] = [];
  let score = 100;

  if (!syntaxValid) {
    reasons.push("Email format is invalid.");
    score = 0;
  }
  if (typoSuggestion) {
    reasons.push(`The domain may be misspelled; check ${typoSuggestion}.`);
    score -= 55;
  }
  if (disposable) {
    reasons.push("Disposable email provider detected.");
    score -= 65;
  }
  if (domainSignals.reachable === false) {
    reasons.push("The domain has no usable mail or address records.");
    score = 0;
  } else if (domainSignals.reachable === null && syntaxValid) {
    reasons.push("The mail domain could not be confirmed.");
    score -= 35;
  }
  if (roleBased) {
    reasons.push("Role-based inbox; review relevance before sending.");
    score -= 10;
  }
  if (history.hardBounce) {
    reasons.push("This address previously hard-bounced.");
    score = 0;
  }
  if (history.complaint) {
    reasons.push("A spam complaint was recorded for this address.");
    score = 0;
  }
  if (history.unsubscribed) {
    reasons.push("This recipient unsubscribed.");
    score = 0;
  }
  if (history.softBounce) {
    reasons.push("This address previously soft-bounced.");
    score -= 30;
  }
  if (history.delivered && !history.hardBounce && !history.complaint && !history.unsubscribed) {
    reasons.push("A previous message was delivered.");
    score = Math.max(score, 85);
  }
  if (domainSignals.error && domainSignals.reachable === null) {
    reasons.push("DNS check returned a temporary error.");
  }

  score = Math.max(0, Math.min(100, score));
  let verdict: EmailValidationVerdict;
  if (!syntaxValid || domainSignals.reachable === false || history.hardBounce || history.complaint || history.unsubscribed || disposable || typoSuggestion) {
    verdict = "invalid";
  } else if (domainSignals.reachable === null) {
    verdict = "unknown";
  } else if (roleBased || history.softBounce || score < 80) {
    verdict = "risky";
  } else {
    verdict = "valid";
  }
  if (!reasons.length) reasons.push("Format and mail domain checks passed.");

  return {
    email: String(value || "").trim(),
    normalizedEmail,
    domain,
    verdict,
    score,
    syntaxValid,
    domainReachable: domainSignals.reachable,
    roleBased,
    disposable,
    typoSuggestion,
    history,
    reasons,
    mxRecords: domainSignals.mxRecords || [],
  };
}

