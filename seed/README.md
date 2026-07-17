# seed/ — shipped enemy-database source data

Unlike `infos/` (gitignored, user-local reference), this directory is committed: everything here is open or original content that is safe to ship (PRD: "SRD/open data only in the repo").

- `Original_Gothic_Horror_Bestiary.csv` — 29 original, non-copyrighted gothic-horror creatures (CoS-*themed*, not copied), full stat-block schema with per-action JSON. Written for this campaign; moved here from `infos/` in issue #6.
- `5e-SRD-Monsters.json` — the 334 fifth-edition (2014) SRD monsters, from [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (`src/2014/en/5e-SRD-Monsters.json`). SRD content used under its open license (OGL/CC-BY-4.0 per that repo).

- `5e-SRD-Spells.json` / `5e-SRD-Equipment.json` — the 319 SRD spells and the SRD equipment table (37 weapons are extracted from it), from [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (`src/2014/en/`), same source and licence as the monsters above. Feeds `npm run gen:library` → `convex/library.ts`.
- `zh-tw-names.json` — our own zh-TW rendering of the SRD's English spell/weapon/school names, translated from the English entries. NOT taken from any published translation; AGPL-3.0 with the rest of our work. Kept separate from the SRD data on purpose: different authors, different licences, and a reader must be able to tell them apart.

The enemy files feed `npm run gen:enemies` (`scripts/gen-enemies.mjs`) → `convex/enemySeed.ts` → the `enemies.seedAll` mutation. Real Curse of Strahd content is never added here — the DM enters it via the in-app custom enemy editor only.
