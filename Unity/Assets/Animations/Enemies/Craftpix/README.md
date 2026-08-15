# Craftpix enemy character sheets

Use **Merchan → Import Character Packs** to regenerate these clips and prefabs. The previous **Import Enemy Character Packs** menu path remains as an alias.

- `Plant1`–`Plant3` and `Orc1`–`Orc3` keep the source 64×64 cells. The four rows are `down`, `left`, `right`, and `up`; actions are taken from the original sheet filenames.
- `Slime1`–`Slime3` and `Vampires1`–`Vampires3` use the same 64×64, four-direction layout. The source actions are preserved as `idle`, `attack`, `walk`, `death`, `hurt`, and `run`.
- `Swordsman_lvl1` is the main-character variant and is generated under `Assets/Prefabs/Player/Craftpix`. `Swordsman_lvl2` is catalogued as a villager/NPC and `Swordsman_lvl3` as a guard; both are generated under `Assets/Prefabs/NPCs/Craftpix`. Their `walk_attack` and `run_attack` sheets remain separate clips rather than being merged into ordinary walking or attack clips.
- `Glassblower_Customer`, `Glassblower_Seller`, and `Glassblower_Master` use 32×32 logical character frames. The source Tiled definition uses 16×16 cells, but each character frame is a 2×2 cell composite, so it is intentionally not split into separate body parts.
- Generated `AnimationClip` states are named `action-direction` (or `idle-rowNN` for the Glassblower rows). The generated prefabs start in their first idle animation and include `EnemyActorAnimator` for selecting another complete clip at runtime.

The source PNG names and the original PNG/Tiled/Aseprite definitions under `assets-src/vendor/craftpix` are retained.
