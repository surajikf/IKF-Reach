export type PersonalizationValues = {
  name?: string;
  company?: string;
  topic?: string;
  research?: string;
  focus_areas?: string;
  industry?: string;
  website?: string;
};

const aliases: Record<string, keyof PersonalizationValues> = {
  name: "name",
  contact: "name",
  "contact name": "name",
  recipient: "name",
  "recipient name": "name",
  person: "name",
  "person name": "name",
  company: "company",
  "company name": "company",
  organization: "company",
  "organization name": "company",
  organisation: "company",
  "organisation name": "company",
  association: "company",
  "association name": "company",
  topic: "topic",
  "email topic": "topic",
  subject: "topic",
  research: "research",
  "research summary": "research",
  "company research": "research",
  "focus area": "focus_areas",
  "focus areas": "focus_areas",
  focus_areas: "focus_areas",
  industry: "industry",
  "industry name": "industry",
  website: "website",
  "website url": "website",
  url: "website",
};

const placeholderPattern = /\{\{\s*([^{}]{1,80})\s*\}\}|\{\s*([^{}]{1,80})\s*\}/g;

export function canonicalPersonalizationKey(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  return aliases[normalized] || null;
}

export function hasPersonalizationPlaceholder(template: string) {
  for (const match of String(template || "").matchAll(new RegExp(placeholderPattern.source, "g"))) {
    if (canonicalPersonalizationKey(match[1] || match[2] || "")) return true;
  }
  return false;
}

export function hasCompanyPlaceholder(template: string) {
  for (const match of String(template || "").matchAll(new RegExp(placeholderPattern.source, "g"))) {
    if (canonicalPersonalizationKey(match[1] || match[2] || "") === "company") return true;
  }
  return false;
}

export function replacePersonalizationPlaceholders(template: string, values: PersonalizationValues) {
  return String(template || "").replace(
    new RegExp(placeholderPattern.source, "g"),
    (_match, doubleKey: string, singleKey: string) => {
      const key = canonicalPersonalizationKey(doubleKey || singleKey || "");
      return key ? String(values[key] || "") : "";
    },
  );
}

export function cleanPersonalizedSubject(value: string) {
  return String(value || "")
    .replace(new RegExp(placeholderPattern.source, "g"), "")
    .replace(/\b(?:with|using|through|about|regarding|around|for)(?:\s+)(?=[,.;:!?-]|$)/gi, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/\s*[-–—|]\s*(?=$)/g, "")
    .replace(/^\s*[-–—|:;,]\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function renderPersonalizedSubject(template: string, values: PersonalizationValues) {
  const subjectTemplate = String(template || "").trim();
  const rendered = replacePersonalizationPlaceholders(subjectTemplate, values);
  const company = String(values.company || "").trim();
  const organizationFirst = company && !hasCompanyPlaceholder(subjectTemplate)
    ? `${company} - ${rendered}`
    : rendered;
  return cleanPersonalizedSubject(organizationFirst);
}
