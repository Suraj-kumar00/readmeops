import { clean } from "./clean.ts";
import { ops } from "./ops.ts";
import { playful } from "./playful.ts";
import { terminal } from "./terminal.ts";
import type { Look, LookId } from "./types.ts";

export const LOOKS: Readonly<Record<LookId, Look>> = { terminal, clean, ops, playful };
export { CARD_WIDTH, LOOK_IDS, SCHEMES } from "./types.ts";
export type { Look, LookId, Scheme } from "./types.ts";
