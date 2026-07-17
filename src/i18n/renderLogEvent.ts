import type { LogEvent, LogEventTarget } from "../../convex/combatLog";
import { summarizeRoll, type DieType } from "../../convex/diceHelpers";
import type { Messages } from "./types";
import { damageTypeLabel, modeLabel, statLabel } from "./terms";

/**
 * Render a structured combat-log event in the viewer's language — the
 * localized twin of the server-composed `rollSummary` (same shape, same
 * numbers). Pure function of (event, messages): switching locale re-renders
 * the whole history. Player-entered text (names, recipe names, extra-roll
 * labels, reaction names) is embedded verbatim.
 */
export function renderLogEvent(event: LogEvent, msg: Messages): string {
  const parts: string[] = [];

  if (event.kind === "manual") {
    if (event.claimedDice !== undefined && event.claimedDice.length > 0) {
      parts.push(
        summarizeRoll(
          event.claimedDice.map((d) => ({ type: d.type as DieType, value: d.value })),
        ),
      );
    }
  } else {
    const targets = event.targets.map((t) => targetText(event.kind, t, msg));
    parts.push(`${event.recipeName ?? ""} · ${targets.join(", ")}`);
    if (event.roleplayNote) parts.push(event.roleplayNote);
  }

  if (event.grants !== undefined && event.grants.length > 0) {
    const grants = event.grants
      .map((g) => `${g.mods.map((m) => modText(m, msg)).join(", ")} → ${g.to}`)
      .join("; ");
    parts.push(`${msg.log.grantsWord} ${grants}`);
  }
  if (event.heals !== undefined && event.heals.length > 0) {
    const heals = event.heals
      .map(
        (h) =>
          `+${h.amount}${h.tempHp ? msg.log.tempSuffix : ""} → ${h.to.join(", ")}`,
      )
      .join("; ");
    parts.push(`${msg.log.healsWord} ${heals}`);
  }
  if (event.spent !== undefined && event.spent.length > 0) {
    const spent = event.spent
      .map((s) => `${s.label}${s.amount !== 1 ? ` ×${s.amount}` : ""}`)
      .join(", ");
    parts.push(`${msg.log.spentWord} ${spent}`);
  }

  return parts.filter((p) => p !== "").join(" · ");
}

function modText(
  m: { mode: string; stat: string; value: number },
  msg: Messages,
): string {
  if (m.mode === "advantage" || m.mode === "disadvantage") {
    return `${modeLabel(msg, m.mode)} ${statLabel(msg, m.stat)}`;
  }
  return `${m.value >= 0 ? "+" : ""}${m.value} ${statLabel(msg, m.stat)}`;
}

function targetText(kind: LogEvent["kind"], t: LogEventTarget, msg: Messages): string {
  const name = t.reactionName ? `${t.name} (${t.reactionName}!)` : t.name;
  const mark = t.autoFail
    ? msg.log.autoFailMark
    : t.adv === "advantage"
      ? msg.log.advMark
      : t.adv === "disadvantage"
        ? msg.log.disadvMark
        : "";
  const forced = t.forced ? msg.log.forcedMark : "";
  const extras =
    t.extras !== undefined && t.extras.length > 0
      ? ` [${t.extras
          .map(
            (x) =>
              `${x.label} +${x.amount}${x.isHeal ? msg.log.healSuffix : ""}`,
          )
          .join(", ")}]`
      : "";
  const dtype = t.damageType ? ` ${damageTypeLabel(msg, t.damageType)}` : "";
  // A darts recipe gated by an attack roll or a save reports both: how many
  // darts this target took, and how the gate went (#33).
  const darts = t.darts !== undefined ? ` ${msg.log.dartsCount(t.darts)}` : "";

  switch (kind) {
    case "darts":
      return `${name}:${forced} ${msg.log.dartsCount(t.darts ?? 0)} → ${t.damage ?? 0}${dtype}${extras}`;
    case "attack": {
      const word = t.hit ? msg.log.hit : msg.log.miss;
      const crit = t.crit ? msg.log.critMark : "";
      const dmg = t.damage !== undefined ? ` ${t.damage}${dtype}` : "";
      const heal = t.heal !== undefined ? ` +${t.heal}${msg.log.healSuffix}` : "";
      return `${name}:${mark}${forced}${darts} ${word}${crit}${dmg}${heal}${extras}`;
    }
    case "save": {
      const word =
        t.saveMode === "hitOrMiss"
          ? t.saveSuccess
            ? msg.log.miss
            : msg.log.hit
          : t.saveSuccess
            ? msg.log.saveWord
            : msg.log.failWord;
      const heal = t.heal !== undefined ? ` +${t.heal}${msg.log.healSuffix}` : "";
      return `${name}:${mark}${forced}${darts} ${word} ${t.damage ?? 0}${dtype}${heal}${extras}`;
    }
    case "heal": {
      const rider = t.damage !== undefined ? ` −${t.damage}` : "";
      return `${name}:${forced} +${t.heal ?? 0}${rider}${extras}`;
    }
    case "auto": {
      const heal = t.heal !== undefined ? ` +${t.heal}${msg.log.healSuffix}` : "";
      return `${name}:${forced} ${t.damage ?? 0}${dtype}${heal}${extras}`;
    }
    default:
      return name;
  }
}
