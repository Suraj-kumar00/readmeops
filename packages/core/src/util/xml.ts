/**
 * Minimal XML parser. Lenient mode reads real-world RSS/Atom feeds; strict mode
 * is used by tests to prove every SVG we emit is well-formed. Never expands DTD
 * entities, so entity-expansion attacks are not possible.
 */
import { decodeEntities } from "./text.ts";

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

export type XmlNode = XmlElement | string;

export class XmlError extends Error {}

export function parseXml(input: string, strict = false): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const n = input.length;
  let i = 0;

  const fail = (message: string): void => {
    if (strict) throw new XmlError(`${message} at offset ${i}`);
  };
  const top = (): XmlElement => stack[stack.length - 1]!;
  const pushRaw = (text: string): void => {
    if (text) top().children.push(text);
  };
  const pushText = (text: string): void => {
    if (!text) return;
    const decoded = decodeEntities(text, strict);
    if (decoded === null) {
      fail("invalid character reference or bare '&' in text");
      pushRaw(text);
      return;
    }
    pushRaw(decoded);
  };

  while (i < n) {
    const lt = input.indexOf("<", i);
    if (lt === -1) {
      pushText(input.slice(i));
      break;
    }
    if (lt > i) pushText(input.slice(i, lt));
    i = lt;

    if (input.startsWith("<!--", i)) {
      const end = input.indexOf("-->", i + 4);
      if (end === -1) {
        fail("unterminated comment");
        break;
      }
      i = end + 3;
      continue;
    }
    if (input.startsWith("<![CDATA[", i)) {
      const end = input.indexOf("]]>", i + 9);
      if (end === -1) {
        fail("unterminated CDATA section");
        pushRaw(input.slice(i + 9));
        break;
      }
      pushRaw(input.slice(i + 9, end));
      i = end + 3;
      continue;
    }
    if (input.startsWith("<?", i)) {
      const end = input.indexOf("?>", i + 2);
      if (end === -1) {
        fail("unterminated processing instruction");
        break;
      }
      i = end + 2;
      continue;
    }
    if (input.startsWith("<!", i)) {
      // DOCTYPE and other declarations: skipped entirely, including internal subsets.
      let depth = 0;
      let j = i + 2;
      for (; j < n; j++) {
        const c = input[j];
        if (c === "[") depth++;
        else if (c === "]") depth--;
        else if (c === ">" && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (input[i + 1] === "/") {
      const end = input.indexOf(">", i);
      if (end === -1) {
        fail("unterminated closing tag");
        break;
      }
      const name = input.slice(i + 2, end).trim();
      let idx = stack.length - 1;
      while (idx > 0 && stack[idx]!.name !== name) idx--;
      if (idx === 0) {
        fail(`unexpected closing tag </${name}>`);
      } else {
        if (idx !== stack.length - 1) fail(`mismatched closing tag </${name}> for <${top().name}>`);
        stack.length = idx;
      }
      i = end + 1;
      continue;
    }

    // Opening tag.
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(input[j]!)) j++;
    const name = input.slice(i + 1, j);
    if (!name || !/^[A-Za-z_][\w.:-]*$/.test(name)) {
      fail(`invalid tag name "${name}"`);
      pushRaw("<");
      i++;
      continue;
    }
    const attrs: Record<string, string> = {};
    let selfClosing = false;
    let closed = false;
    while (j < n) {
      while (j < n && /\s/.test(input[j]!)) j++;
      const c = input[j];
      if (c === ">") {
        closed = true;
        j++;
        break;
      }
      if (c === "/" && input[j + 1] === ">") {
        selfClosing = true;
        closed = true;
        j += 2;
        break;
      }
      let k = j;
      while (k < n && !/[\s=/>]/.test(input[k]!)) k++;
      const attrName = input.slice(j, k);
      if (!attrName) {
        fail("malformed attribute");
        j = k + 1;
        continue;
      }
      while (k < n && /\s/.test(input[k]!)) k++;
      if (input[k] !== "=") {
        fail(`attribute "${attrName}" has no value`);
        attrs[attrName] = "";
        j = k;
        continue;
      }
      k++;
      while (k < n && /\s/.test(input[k]!)) k++;
      const quote = input[k];
      let value: string;
      if (quote === '"' || quote === "'") {
        const endQuote = input.indexOf(quote, k + 1);
        if (endQuote === -1) {
          fail("unterminated attribute value");
          j = n;
          break;
        }
        value = input.slice(k + 1, endQuote);
        j = endQuote + 1;
      } else {
        fail(`attribute "${attrName}" value must be quoted`);
        let e = k;
        while (e < n && !/[\s>]/.test(input[e]!)) e++;
        value = input.slice(k, e);
        j = e;
      }
      if (strict && value.includes("<")) fail(`'<' in attribute "${attrName}"`);
      if (strict && attrName in attrs) fail(`duplicate attribute "${attrName}"`);
      const decoded = decodeEntities(value, strict);
      if (decoded === null) fail(`invalid entity in attribute "${attrName}"`);
      attrs[attrName] = decoded ?? value;
    }
    if (!closed) {
      fail(`unterminated tag <${name}>`);
      break;
    }
    const element: XmlElement = { name, attrs, children: [] };
    top().children.push(element);
    if (!selfClosing) stack.push(element);
    i = j;
  }

  if (stack.length > 1) fail(`unclosed element <${top().name}>`);
  const elements = root.children.filter((c): c is XmlElement => typeof c !== "string");
  if (strict && elements.length !== 1) throw new XmlError(`expected exactly one root element, found ${elements.length}`);
  return root;
}

export function isElement(node: XmlNode | undefined): node is XmlElement {
  return typeof node === "object" && node !== null;
}

export function children(el: XmlElement, name?: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => isElement(c) && (name === undefined || c.name === name));
}

export function child(el: XmlElement, ...names: string[]): XmlElement | undefined {
  for (const name of names) {
    const hit = el.children.find((c): c is XmlElement => isElement(c) && c.name === name);
    if (hit) return hit;
  }
  return undefined;
}

export function textOf(el: XmlElement | undefined): string {
  if (!el) return "";
  return el.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
}
