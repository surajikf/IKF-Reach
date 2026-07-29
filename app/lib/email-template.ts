import { replacePersonalizationPlaceholders, type PersonalizationValues } from "./personalization";

export const RICH_EMAIL_TEMPLATE_FORMAT = "rich_html_v1";
export const LEGACY_EMAIL_TEMPLATE_FORMAT = "legacy_text_v1";

const allowedTags = new Set([
  "a", "b", "br", "div", "em", "font", "i", "li", "ol", "p", "span", "strong", "u", "ul",
]);

const allowedStyleProperties = new Set([
  "background-color",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "margin-left",
  "text-align",
  "text-decoration",
]);

const allowedFonts = [
  "calibri",
  "arial",
  "verdana",
  "tahoma",
  "georgia",
  "times new roman",
  "sans-serif",
  "serif",
];

function escapeHtml(value: unknown) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: unknown) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function safeLink(value: string) {
  const decoded = String(value || "").trim().replace(/&amp;/g, "&");
  return /^(?:https?:\/\/|mailto:|tel:)/i.test(decoded) ? decoded : "";
}

function safeColor(value: string) {
  const color = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^rgba?\(\s*[\d.%\s,]+\)$/i.test(color)) return color;
  if (/^[a-z]{3,20}$/i.test(color)) return color;
  return "";
}

function sanitizeStyle(value: string) {
  const declarations: string[] = [];
  for (const entry of String(value || "").split(";")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    const property = entry.slice(0, separator).trim().toLowerCase();
    let styleValue = entry.slice(separator + 1).trim();
    if (!allowedStyleProperties.has(property) || /url\s*\(|expression\s*\(|javascript:/i.test(styleValue)) continue;
    if (property === "font-family") {
      const selected = styleValue
        .split(",")
        .map((font) => font.trim().replace(/^['"]|['"]$/g, ""))
        .filter((font) => allowedFonts.includes(font.toLowerCase()));
      if (!selected.length) continue;
      styleValue = selected.map((font) => font.includes(" ") ? `'${font}'` : font).join(", ");
    } else if (property === "font-size" && !/^(?:[89]|1\d|2[0-4])(?:px|pt)$/i.test(styleValue)) {
      continue;
    } else if (property === "font-weight" && !/^(?:normal|bold|[1-9]00)$/i.test(styleValue)) {
      continue;
    } else if (property === "font-style" && !/^(?:normal|italic)$/i.test(styleValue)) {
      continue;
    } else if (property === "text-decoration" && !/^(?:none|underline|line-through)(?:\s+(?:underline|line-through))*$/i.test(styleValue)) {
      continue;
    } else if (property === "text-align" && !/^(?:left|center|right|justify)$/i.test(styleValue)) {
      continue;
    } else if ((property === "color" || property === "background-color")) {
      styleValue = safeColor(styleValue);
      if (!styleValue) continue;
    } else if (property === "line-height" && !/^(?:1(?:\.\d)?|2|(?:1\d|2[0-4])(?:px|pt))$/i.test(styleValue)) {
      continue;
    } else if (property === "margin-left" && !/^(?:0|(?:[1-9]|[1-4]\d)(?:px|pt))$/i.test(styleValue)) {
      continue;
    }
    declarations.push(`${property}:${styleValue}`);
  }
  return declarations.join(";");
}

function attributeValue(attributes: string, name: string) {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, "i"));
  return String(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

export function sanitizeRichEmailTemplate(input: unknown) {
  let html = String(input || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|meta|link)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|svg|math|meta|link)\b[^>]*\/?>/gi, "");

  html = html.replace(/<\/?([a-z0-9]+)\b([^>]*)>/gi, (original, rawTag: string, attributes: string) => {
    const tag = rawTag.toLowerCase();
    if (!allowedTags.has(tag)) return "";
    const closing = /^<\//.test(original);
    if (closing) return tag === "br" ? "" : `</${tag}>`;
    if (tag === "br") return "<br>";

    const safeAttributes: string[] = [];
    const style = sanitizeStyle(attributeValue(attributes, "style"));
    if (style) safeAttributes.push(`style="${escapeAttribute(style)}"`);

    if (tag === "a") {
      const href = safeLink(attributeValue(attributes, "href"));
      if (href) {
        safeAttributes.push(`href="${escapeAttribute(href)}"`);
        safeAttributes.push('target="_blank"');
        safeAttributes.push('rel="noopener noreferrer"');
      }
    }

    if (tag === "font") {
      const face = attributeValue(attributes, "face").trim();
      const size = attributeValue(attributes, "size").trim();
      const color = safeColor(attributeValue(attributes, "color"));
      if (face && allowedFonts.includes(face.toLowerCase())) safeAttributes.push(`face="${escapeAttribute(face)}"`);
      if (/^[1-7]$/.test(size)) safeAttributes.push(`size="${size}"`);
      if (color) safeAttributes.push(`color="${escapeAttribute(color)}"`);
    }

    return `<${tag}${safeAttributes.length ? ` ${safeAttributes.join(" ")}` : ""}>`;
  });

  return cleanupRichEmailHtml(html, true);
}

export function richEmailTemplateToText(input: unknown) {
  return sanitizeRichEmailTemplate(input)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanupRichEmailHtml(input: unknown, preservePlaceholders = false) {
  let html = String(input || "")
    .replace(
      /\{\{\s*[^{}]{1,80}\s*\}\}|\{\s*[^{}]{1,80}\s*\}/g,
      (placeholder) => preservePlaceholders ? placeholder : "",
    )
    .replace(/<(strong|u|em|b|i|span|font)(?:\s[^>]*)?>\s*<\/\1>/gi, "")
    .replace(/<(p|div|li)(?:\s[^>]*)?>\s*(?:<br>\s*)*<\/\1>/gi, "")
    .replace(/<(ul|ol)(?:\s[^>]*)?>\s*<\/\1>/gi, "")
    .replace(/\b(?:with|using|through|about|regarding|around|for)(?:\s|&nbsp;)+(?=(?:to|and|or)\b|[,.;:!?])/gi, "")
    .replace(/(?:\s|&nbsp;)+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  html = html.replace(/<(p|div|li)(?:\s[^>]*)?>\s*(?:<br>\s*)*<\/\1>/gi, "");
  return html.trim();
}

export function renderRichEmailTemplate(
  template: string,
  values: Required<Pick<PersonalizationValues, "name" | "company" | "topic" | "research" | "focus_areas">> & Partial<PersonalizationValues>,
) {
  const safeTemplate = sanitizeRichEmailTemplate(template);
  const markers: string[] = [];
  const markerValues: PersonalizationValues = {};
  for (const [key, rawValue] of Object.entries(values)) {
    const marker = `IKFRICHPERSONALIZATION${markers.length}END`;
    markers.push(escapeHtml(rawValue));
    markerValues[key as keyof PersonalizationValues] = marker;
  }
  let rendered = replacePersonalizationPlaceholders(safeTemplate, markerValues);
  markers.forEach((value, index) => {
    rendered = rendered.split(`IKFRICHPERSONALIZATION${index}END`).join(value);
  });
  rendered = rendered.replace(/\bAI\b/g, "Ai");
  return cleanupRichEmailHtml(rendered);
}
