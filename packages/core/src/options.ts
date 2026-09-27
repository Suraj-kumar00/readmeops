/**
 * Settings, as the Action inputs and the editor express them. Everything is
 * optional: with no settings you get the default look and cards.
 */
import { LOOK_IDS, type LookId } from "./looks/types.ts";
import { CARD_IDS, type CardId } from "./view.ts";

export interface Options {
  look: LookId;
  cards: CardId[];
  /** One line about you; defaults to the first part of your GitHub bio. */
  headline: string | null;
  /** Programs, communities or certifications, one per line. */
  programs: string[];
  /** RSS or Atom feed URLs for the writing card. */
  feeds: string[];
}

export const DEFAULT_LOOK: LookId = "clean";
export const DEFAULT_CARDS: CardId[] = ["profile", "stats", "activity", "upstream", "languages"];

export class OptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OptionsError";
  }
}

const MAX_PROGRAMS = 4;
const MAX_LINE = 80;

function lines(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function parseLook(value: string | undefined): LookId {
  const v = (value ?? "").trim().toLowerCase();
  if (!v) return DEFAULT_LOOK;
  if ((LOOK_IDS as readonly string[]).includes(v)) return v as LookId;
  throw new OptionsError(`Unknown look "${value}". Use one of: ${LOOK_IDS.join(", ")}.`);
}

export function parseCards(value: string | undefined): CardId[] {
  const items = (value ?? "")
    .split(/[\s,]+/)
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
  if (items.length === 0) return [...DEFAULT_CARDS];
  const unknown = items.filter((c) => !(CARD_IDS as readonly string[]).includes(c));
  if (unknown.length) throw new OptionsError(`Unknown card "${unknown[0]}". Use any of: ${CARD_IDS.join(", ")}.`);
  return [...new Set(items)] as CardId[];
}

export function parseFeeds(value: string | undefined): string[] {
  const feeds = (value ?? "")
    .split(/[\s,]+/)
    .map((f) => f.trim())
    .filter(Boolean);
  for (const f of feeds) {
    let url: URL;
    try {
      url = new URL(f);
    } catch {
      throw new OptionsError(`"${f}" is not a valid feed URL.`);
    }
    if (url.protocol !== "https:") throw new OptionsError(`Feed URLs must use https: ${f}`);
  }
  return feeds.slice(0, 3);
}

export function parsePrograms(value: string | undefined): string[] {
  const items = lines(value);
  const long = items.find((p) => p.length > MAX_LINE);
  if (long) throw new OptionsError(`Keep each program under ${MAX_LINE} characters: "${long.slice(0, 40)}…"`);
  return items.slice(0, MAX_PROGRAMS);
}

export function parseHeadline(value: string | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  if (!v) return null;
  if (v.length > MAX_LINE) throw new OptionsError(`Keep the headline under ${MAX_LINE} characters.`);
  return v;
}

/** GitHub logins: alphanumerics and single hyphens, up to 39 characters. */
export function isLogin(value: string): boolean {
  return /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(value);
}

export function parseOptions(input: { look?: string; cards?: string; headline?: string; programs?: string; blog?: string }): Options {
  return {
    look: parseLook(input.look),
    cards: parseCards(input.cards),
    headline: parseHeadline(input.headline),
    programs: parsePrograms(input.programs),
    feeds: parseFeeds(input.blog),
  };
}
