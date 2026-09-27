/** Escaping, entity decoding and small text helpers for SVG output and feed parsing. */

// Characters that are illegal in XML 1.0 documents.
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function sanitizeXmlChars(value: string): string {
  return value.replace(INVALID_XML, "").replace(LONE_SURROGATE, "�");
}

/** Escape text for XML/SVG and HTML (text nodes and double- or single-quoted attributes). */
export function escapeXml(value: string): string {
  return sanitizeXmlChars(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

const HTML_ENTITIES: Record<string, string> = {
  ...XML_ENTITIES,
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  middot: "·",
  bull: "•",
  lpar: "(",
  rpar: ")",
  colon: ":",
  times: "×",
};

/**
 * Decode character references. `strict` only accepts the five XML entities and
 * numeric references, and returns null when it meets anything else.
 */
export function decodeEntities(value: string, strict = false): string | null {
  let invalid = false;
  const out = value.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (match, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        invalid = true;
        return match;
      }
      return String.fromCodePoint(code);
    }
    const table = strict ? XML_ENTITIES : HTML_ENTITIES;
    const hit = table[ref];
    if (hit === undefined) {
      if (strict) invalid = true;
      return match;
    }
    return hit;
  });
  if (strict && (invalid || /&(?!(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);)/.test(value))) return null;
  return out;
}

/** Remove tags, decode entities, collapse whitespace. For summaries only, never for output HTML. */
export function stripHtml(html: string): string {
  const noScripts = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const noTags = noScripts.replace(/<[^>]*>/g, " ");
  return (decodeEntities(noTags) ?? noTags).replace(/\s+/g, " ").trim();
}

/** Truncate to a number of characters (code points), appending an ellipsis. */
export function truncateChars(value: string, max: number): string {
  const chars = Array.from(value);
  if (chars.length <= max) return value;
  if (max <= 1) return "…";
  return chars.slice(0, max - 1).join("").trimEnd() + "…";
}


export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
