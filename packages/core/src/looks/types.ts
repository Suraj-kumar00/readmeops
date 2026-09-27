import type { CardId, View } from "../view.ts";

export type Scheme = "dark" | "light";
export const SCHEMES: readonly Scheme[] = ["dark", "light"];

export const LOOK_IDS = ["terminal", "clean", "ops", "playful"] as const;
export type LookId = (typeof LOOK_IDS)[number];

export interface Look {
  id: LookId;
  name: string;
  description: string;
  render(card: CardId, view: View, scheme: Scheme): string;
}

/** Every card is drawn at this width; GitHub scales it down on narrow screens. */
export const CARD_WIDTH = 840;
