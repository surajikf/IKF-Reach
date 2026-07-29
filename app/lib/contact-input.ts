export type ParsedContactInput = {
  email: string;
  name: string;
  company?: string;
  website?: string;
  research?: unknown;
};

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const contactMarkerPattern = /(?:Tel|Fax|Email|E-mail|Web|Website)\s*:/i;

export function parseContactInput(text: string): ParsedContactInput[] {
  const contacts: ParsedContactInput[] = [];
  for (const line of String(text || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
    const emails = line.match(emailPattern) || [];
    const website = extractExplicitWebsite(line);
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      const angleName = line.match(new RegExp(`^\\s*([^<,;]+)\\s*<\\s*${escapeRegExp(rawEmail)}`, "i"))?.[1]?.trim() || "";
      const fields = line.split(/[,;\t]/).map((item) => item.trim()).filter(Boolean);
      const nonEmailFields = fields.filter((item) => !item.includes("@") && !/^https?:\/\//i.test(item));
      const name = angleName || (nonEmailFields.length ? nonEmailFields[0] : "");
      const company = nonEmailFields.length > 1 ? nonEmailFields[1] : undefined;
      if (!contacts.some((item) => item.email === email)) contacts.push({ email, name, company, website });
    }
  }
  return contacts;
}

export function parseDocumentContactInput(text: string): ParsedContactInput[] {
  const lines = String(text || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    const rowStart = splitNumberedRow(line);
    if (rowStart !== null) {
      if (current) blocks.push(current);
      current = rowStart ? [rowStart] : [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) blocks.push(current);

  const structured: ParsedContactInput[] = [];
  for (const block of blocks) {
    const blockText = block.join("\n");
    const emails = blockText.match(emailPattern) || [];
    if (!emails.length) continue;
    const company = companyFromBlock(block);
    const website = extractExplicitWebsite(blockText);
    for (const rawEmail of emails) {
      const email = rawEmail.toLowerCase();
      if (!structured.some((item) => item.email === email)) {
        structured.push({ email, name: "", company: company || undefined, website });
      }
    }
  }

  return mergeContactInputs(structured, parseContactInput(text));
}

export function mergeContactInputs(...groups: ParsedContactInput[][]): ParsedContactInput[] {
  const merged = new Map<string, ParsedContactInput>();
  for (const contact of groups.flat()) {
    const email = String(contact.email || "").trim().toLowerCase();
    if (!email) continue;
    const existing = merged.get(email);
    if (!existing) {
      merged.set(email, { ...contact, email });
      continue;
    }
    merged.set(email, {
      ...existing,
      name: existing.name || contact.name || "",
      company: existing.company || contact.company,
      website: existing.website || contact.website,
      research: existing.research || contact.research,
    });
  }
  return [...merged.values()];
}

function splitNumberedRow(line: string) {
  const match = line.match(/^(\d{1,3})(?:\s+(.+))?$/);
  if (!match) return null;
  const remainder = String(match[2] || "").trim();
  if (
    remainder &&
    (
      !/[A-Za-z]/.test(remainder) ||
      remainder.length < 3 ||
      /^(?:\d|tel|fax|email|e-mail|web|website)\b/i.test(remainder)
    )
  ) return null;
  return remainder;
}

function companyFromBlock(block: string[]) {
  const parts: string[] = [];
  for (const rawLine of block) {
    const markerIndex = rawLine.search(contactMarkerPattern);
    const companyPart = (markerIndex >= 0 ? rawLine.slice(0, markerIndex) : rawLine).trim();
    if (companyPart) parts.push(companyPart);
    if (markerIndex >= 0) break;
  }
  return parts
    .join(" ")
    .replace(/[‟”“]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExplicitWebsite(text: string) {
  const match = String(text || "").match(/(?:https?:\/\/|www\.)[^\s,;<>"']+/i)?.[0];
  return match?.replace(/[)\].,;:]+$/g, "");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
