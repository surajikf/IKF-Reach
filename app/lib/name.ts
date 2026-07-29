const genericMailboxWords = new Set([
  "admin", "business", "care", "communications", "connect", "contact", "coordinator",
  "enquiry", "enquiries", "forum", "general", "hello", "help", "hr", "info",
  "mail", "marketing", "membership", "office", "president", "sales", "secretary",
  "service", "support", "team",
]);

const organizationClues = /(association|council|chamber|company|corporate|delhi|federation|foundation|group|india|mumbai|office|organisation|organization|society|team)/i;

export function inferContactName(email: string, supplied?: string | null) {
  const knownName = String(supplied || "").trim();
  if (knownName && knownName.toLowerCase() !== "sir/madam") return knownName;

  const localPart = String(email || "").split("@")[0].toLowerCase();
  const hadDigits = /\d/.test(localPart);
  const tokens = localPart
    .replace(/\d+/g, ".")
    .split(/[._-]+/)
    .map((token) => token.replace(/[^a-z]/g, ""))
    .filter(Boolean);

  if (!tokens.length || tokens.length > 4) return "Sir/Madam";
  if (tokens.some((token) => genericMailboxWords.has(token) || organizationClues.test(token))) return "Sir/Madam";
  if (!tokens.every((token) => /^[a-z]{1,20}$/.test(token))) return "Sir/Madam";

  const hasNameWord = tokens.some((token) => token.length >= 2);
  const isInitialAndName = tokens.length >= 2 && hasNameWord;
  const isNumberDecoratedSingleName = tokens.length === 1 && hadDigits && tokens[0].length >= 3;
  if (!isInitialAndName && !isNumberDecoratedSingleName) return "Sir/Madam";

  return tokens
    .map((token) => token.length === 1 ? token.toUpperCase() : token[0].toUpperCase() + token.slice(1))
    .join(" ");
}
