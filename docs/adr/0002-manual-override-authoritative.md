# Manual override is always authoritative

Automation in the combat engine is a convenience layer over manual DM control, never a replacement for it. Any stat on any combatant can be edited directly; any combatant (PC, NPC, or enemy) can be spawned or killed in one click; any computed result (hit/miss, damage, save) can be forced. When automation and a manual edit disagree, the manual edit wins.

The whole point of the project is to handle complicated/homebrew characters and special play styles that a rules-strict engine cannot anticipate. Building rule enforcement that blocks the DM would defeat that goal. So the engine computes and suggests; the DM decides. Enemy-database entries are templates — spawning one creates an independent, fully editable instance, so the DM is never stuck with the system's stats.
