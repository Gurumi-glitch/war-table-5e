import type { CharacterView } from "../../convex/characters";
import type { Messages } from "../i18n";
import { ABILITY_KEYS, defaultSaves, defaultSkills, modByKey } from "./dndCalc";

/**
 * Character-card files (prep-public-release / design D4): a card leaves as one
 * `.dndcard.json` and comes back through the server's import customs. This is
 * how a demo visitor keeps a character the demo's periodic wipe will delete,
 * and how any table moves a PC between deployments.
 *
 * Export is pure frontend — it serializes data the client already holds, so it
 * needs no backend at all. Import is a mutation (`characters.importCards`),
 * because trusting a file the visitor hand-edited is exactly what customs is
 * for; nothing here re-checks what the server checks.
 */

/** The envelope's discriminator — the server rejects anything else. */
export const CARD_FILE_FORMAT = "war-table-5e-character";

/** Bumped only when the card shape changes in a way an old file can't express. */
export const CARD_FILE_VERSION = 2;

export type CardFile = {
  format: typeof CARD_FILE_FORMAT;
  version: number;
  exportedAt: string;
  cards: Record<string, unknown>[];
};

/**
 * Strip a card view down to the portable card, children and all.
 *
 * The card FIELDS are taken as a rest-destructure rather than a whitelist, so
 * a field added to the card is exported the day it is added — the failure mode
 * of a hand-kept list is a silently un-exported field, discovered only after
 * the data it protected is gone.
 *
 * The named keys are the non-portable ones: database identity
 * (`_id`/`_creationTime`) and the seed marker (a card you export is yours, not
 * the demo's furniture — design D3). Child rows are re-attached below in a
 * portable shape.
 *
 * **The children are the point.** A card's recipes and resources are most of
 * what a character IS — a Paladin without 聖療 or its pool is a stat block —
 * and character-owned effects are campaign state the schema deliberately
 * persists across Games (a lingering curse). This file is the only form a card
 * takes outside the database, so anything omitted here is destroyed by a wipe.
 *
 * Recipe→resource links survive as `resourceKey`, the pool's LABEL rather than
 * its database id: ids are meaningless in another deployment, whereas the
 * label is stable, human-readable in the file, and the same trick the seed
 * pipeline already uses. Labels are unique within a card in practice; if two
 * ever collide, the importer binds to the first, which is a duplicated pool —
 * visibly wrong on the card, not silently wrong in the math.
 */
export function toPortableCard(card: CharacterView): Record<string, unknown> {
  const { _id, _creationTime, seedKey, resources, recipes, effects, ...fields } =
    card;
  const labelById = new Map(resources.map((r) => [r._id, r.label]));
  return {
    ...fields,
    resources: resources.map(({ _id, _creationTime, combatantId, ...r }) => r),
    recipes: recipes.map(
      ({ _id, _creationTime, combatantId, resourceId, ...r }) => ({
        ...r,
        ...(resourceId !== null && labelById.has(resourceId)
          ? { resourceKey: labelById.get(resourceId) }
          : {}),
      }),
    ),
    effects: effects.map(({ _id, _creationTime, combatantId, ...e }) => e),
  };
}

/** Wrap cards in the file envelope (design D4: always an array, 1..N). */
export function buildCardFile(cards: CharacterView[]): CardFile {
  return {
    format: CARD_FILE_FORMAT,
    version: CARD_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    cards: cards.map(toPortableCard),
  };
}

/** A filename a filesystem will accept, from a name a player invented. */
function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, "").trim();
  return `${cleaned === "" ? "character" : cleaned}.dndcard.json`;
}

/**
 * Download one card as `<name>.dndcard.json`. Object-URL + synthetic click is
 * the only way to name a download without a server round-trip; the URL is
 * revoked immediately after, since the browser has already read the blob.
 */
export function downloadCard(card: CharacterView): void {
  const json = JSON.stringify(buildCardFile([card]), null, 2);
  const url = URL.createObjectURL(
    new Blob([json], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(card.nameZh || card.nameEn);
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * A blank card's starting values (character-creation spec): level 1, every
 * ability 10/+0, save/skill templates built from those — i.e. what the editor
 * would compute anyway, so the new card opens consistent rather than showing a
 * row of zeros until the first Recalc.
 */
export function blankCardFields(t: Messages): Record<string, unknown> {
  const abilities = ABILITY_KEYS.map((key) => ({ key, score: 10, mod: 0 }));
  const mods = modByKey(abilities);
  const pb = 2;
  return {
    player: "",
    nameZh: t.card.newCardName,
    nameEn: "",
    race: "",
    classesText: "",
    level: 1,
    alignment: "",
    statusText: "",
    hp: 10,
    maxHp: 10,
    ac: 10,
    acFormula: "",
    speedText: "30",
    initBonus: 0,
    pb,
    abilities,
    spellcastingAbility: "",
    spellAttack: 0,
    spellDc: 0,
    passivePerception: 10,
    attackText: "",
    saves: defaultSaves(mods, pb),
    skills: defaultSkills(mods, pb),
    toolsText: "",
    goldText: "",
    refs: [],
    classRules: [],
    story: "",
  };
}

/**
 * Turn a card-write rejection into a sentence in the reader's language
 * (design D9). The server throws a stable `code` rather than a message
 * because the demo's audience is bilingual and the server cannot know which
 * language the visitor is reading in.
 *
 * Anything without a recognized code — a network drop, a bug — falls through
 * to a generic line: a failed save must always say SOMETHING, since silence
 * looks identical to success and the next thing the user does is close the tab.
 */
export function cardErrorMessage(error: unknown, t: Messages): string {
  const data = (error as { data?: unknown })?.data;
  const code =
    data !== null && typeof data === "object"
      ? (data as { code?: unknown }).code
      : undefined;
  switch (code) {
    case "card.fieldTooLong":
      return t.cardErrors.fieldTooLong;
    case "card.cardTooLarge":
      return t.cardErrors.cardTooLarge;
    case "card.badEnvelope":
      return t.cardErrors.badEnvelope;
    case "card.unsupportedVersion":
      return t.cardErrors.unsupportedVersion;
    case "card.seedReadOnly":
      return t.cardErrors.seedReadOnly;
    default:
      return t.cardErrors.unknown;
  }
}
