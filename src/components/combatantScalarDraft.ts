/**
 * Build the scalar portion of a Combatant patch from a local string draft.
 * Notes remain text; blank numeric drafts are deliberately omitted so an
 * in-progress clear is never coerced to zero by Number("").
 */
export function buildCombatantScalarChanges<Field extends string>(
  fields: readonly Field[],
  draft: Record<Field, string>,
  base: Record<Field, string>,
): Record<string, string | number> {
  const changes: Record<string, string | number> = {};
  for (const field of fields) {
    if (draft[field] === base[field]) continue;
    if (field === "notes" || field === "dmNotes") {
      changes[field] = draft[field];
    } else {
      if (draft[field].trim() === "") continue;
      changes[field] = Number(draft[field]);
    }
  }
  return changes;
}
