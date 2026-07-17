import { ConvexError } from "convex/values";

/**
 * Customs for character-card writes (prep-public-release). Two concerns, one
 * module because they guard the same three doors (`create` / `update` /
 * `importCards`):
 *
 *  1. Size limits — every deployment, always on (design D5). Origin: a player
 *     pasted a ten-thousand-line wild-magic table onto a card and hung the
 *     table's browsers.
 *  2. `PLAYGROUND_MODE` — the public-demo flag (design D1). Off/unset is the
 *     SAFE side: a self-hoster who sets nothing gets exactly the pre-existing
 *     friend-group behavior (global cards, everything editable, no banner).
 *     Only `true` opts a deployment into demo enforcement.
 *
 * Visitor-facing errors here throw `ConvexError` with a stable `code` — the
 * client maps it through `src/i18n/locales` (design D9), because a public demo
 * has a bilingual audience and the server does not know the viewer's language.
 */

// The Convex runtime exposes `process.env`, but `convex/tsconfig.json` omits
// Node's types on purpose (the runtime is not Node) — so declare the single
// binding we use rather than pulling in a Node environment that isn't there.
declare const process: { env: Record<string, string | undefined> };

/** Max characters in any one free-text field (real-data max is 1,264). */
export const MAX_FIELD_CHARS = 30_000;

/** Max serialized size of one whole card, in bytes. */
export const MAX_CARD_BYTES = 300_000;

/** Stable error codes; the client renders these via the locale files (D9). */
export const CARD_ERROR = {
  fieldTooLong: "card.fieldTooLong",
  cardTooLarge: "card.cardTooLarge",
  badEnvelope: "card.badEnvelope",
  seedReadOnly: "card.seedReadOnly",
} as const;

/** Whether this deployment runs as the public playground (design D1). */
export function isPlaygroundMode(): boolean {
  return process.env.PLAYGROUND_MODE === "true";
}

/**
 * Walk every string a card carries, whatever the shape: top-level text fields,
 * `refs[].title/body`, `classRules[]`. Walking the value generically (rather
 * than listing fields) means a field added later is covered on the day it is
 * added — the failure mode of an explicit list is silence, not an error.
 */
function eachString(value: unknown, visit: (s: string) => void): void {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const item of value) eachString(item, visit);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) eachString(item, visit);
  }
}

/**
 * Enforce the size limits on a card's fields (whole card on create/import, the
 * dirty subset on update — a patch can only ever grow the fields it carries).
 * Throws `ConvexError` with a D9 code; call before any insert/patch.
 */
export function validateCardSize(fields: unknown): void {
  eachString(fields, (s) => {
    if (s.length > MAX_FIELD_CHARS) {
      throw new ConvexError({
        code: CARD_ERROR.fieldTooLong,
        max: MAX_FIELD_CHARS,
        actual: s.length,
      });
    }
  });
  // Byte length, not string length: the cards are Chinese, where one character
  // costs three bytes — measuring in characters would under-count by 3x.
  const bytes = new TextEncoder().encode(JSON.stringify(fields)).length;
  if (bytes > MAX_CARD_BYTES) {
    throw new ConvexError({
      code: CARD_ERROR.cardTooLarge,
      max: MAX_CARD_BYTES,
      actual: bytes,
    });
  }
}

/**
 * Reject writes to a seeded demo card on the playground (design D3): seeded
 * cards are the demo's furniture, and a public URL means anyone can scribble.
 * No `locked` column — `seedKey` already marks exactly these cards, and the
 * flag scopes the rule to the demo, so the friend group's own six seeded cards
 * stay editable on their own deployment.
 */
export function assertCardWritable(character: { seedKey?: string }): void {
  if (isPlaygroundMode() && character.seedKey !== undefined) {
    throw new ConvexError({ code: CARD_ERROR.seedReadOnly });
  }
}
