/** Imported 16px-grid environment sheets.  These are visual assets only;
 * walkability is still authored in the manual map collision layer. */
export const CRAFTPIX_ENVIRONMENT_SHEETS = {
  "home-exterior": { textureKey: "craftpix.env.home-exterior", path: "assets/craftpix/packs/main-home/exterior.png", columns: 15, frames: 750, label: "Home exterior" },
  "home-interior": { textureKey: "craftpix.env.home-interior", path: "assets/craftpix/packs/main-home/Interior.png", columns: 12, frames: 300, label: "Home interior" },
  "home-ground-details": { textureKey: "craftpix.env.home-ground-details", path: "assets/craftpix/packs/main-home/ground_grass_details.png", columns: 21, frames: 378, label: "Home ground details" },
  "home-house-details": { textureKey: "craftpix.env.home-house-details", path: "assets/craftpix/packs/main-home/house_details.png", columns: 10, frames: 170, label: "Home house details" },
  "home-walls-floor": { textureKey: "craftpix.env.home-walls-floor", path: "assets/craftpix/packs/main-home/walls_floor.png", columns: 9, frames: 99, label: "Home walls and floor" },
  "guild-exterior": { textureKey: "craftpix.env.guild-exterior", path: "assets/craftpix/packs/guild-hall/Exterior.png", columns: 28, frames: 252, label: "Guild exterior" },
  "guild-interior-objects": { textureKey: "craftpix.env.guild-interior-objects", path: "assets/craftpix/packs/guild-hall/Interior_objects.png", columns: 24, frames: 576, label: "Guild interior objects" },
  "guild-walls-interior": { textureKey: "craftpix.env.guild-walls-interior", path: "assets/craftpix/packs/guild-hall/Walls_interior.png", columns: 24, frames: 192, label: "Guild interior walls" },
  "guild-walls-street": { textureKey: "craftpix.env.guild-walls-street", path: "assets/craftpix/packs/guild-hall/Walls_street.png", columns: 21, frames: 378, label: "Guild street walls" },
  "guild-windows-doors": { textureKey: "craftpix.env.guild-windows-doors", path: "assets/craftpix/packs/guild-hall/Windows_doors.png", columns: 18, frames: 324, label: "Guild windows and doors" },
  "guild-fire": { textureKey: "craftpix.env.guild-fire", path: "assets/craftpix/packs/guild-hall/Fire.png", columns: 24, frames: 72, label: "Guild fire" },
  "guild-flags": { textureKey: "craftpix.env.guild-flags", path: "assets/craftpix/packs/guild-hall/Flags_animation.png", columns: 6, frames: 216, label: "Guild flags" },
  "glassblower-exterior": { textureKey: "craftpix.env.glassblower-exterior", path: "assets/craftpix/packs/glassblower-workshop/Exterior_house.png", columns: 25, frames: 325, label: "Glassblower exterior" },
  "glassblower-interior-objects": { textureKey: "craftpix.env.glassblower-interior-objects", path: "assets/craftpix/packs/glassblower-workshop/Interior_objects.png", columns: 13, frames: 507, label: "Glassblower interior objects" },
  "glassblower-walls-interior": { textureKey: "craftpix.env.glassblower-walls-interior", path: "assets/craftpix/packs/glassblower-workshop/Walls_interior.png", columns: 16, frames: 272, label: "Glassblower interior walls" },
  "glassblower-walls-street": { textureKey: "craftpix.env.glassblower-walls-street", path: "assets/craftpix/packs/glassblower-workshop/Walls_street.png", columns: 21, frames: 378, label: "Glassblower street walls" },
  "glassblower-forge": { textureKey: "craftpix.env.glassblower-forge", path: "assets/craftpix/packs/glassblower-workshop/Forge.png", columns: 24, frames: 144, label: "Glassblower forge" },
  "glassblower-doors-windows": { textureKey: "craftpix.env.glassblower-doors-windows", path: "assets/craftpix/packs/glassblower-workshop/Doors_windows_animations.png", columns: 12, frames: 432, label: "Glassblower windows" },
  "dungeon-other-objects": { textureKey: "craftpix.env.dungeon-other-objects", path: "assets/craftpix/packs/dungeon-objects/Other_objects.png", columns: 22, frames: 154, label: "Dungeon objects" },
  "dungeon-supplies": { textureKey: "craftpix.env.dungeon-supplies", path: "assets/craftpix/packs/dungeon-objects/supplies_objects.png", columns: 13, frames: 481, label: "Dungeon supplies" },
  "dungeon-pedestals": { textureKey: "craftpix.env.dungeon-pedestals", path: "assets/craftpix/packs/dungeon-objects/pedestals.png", columns: 35, frames: 280, label: "Dungeon pedestals" },
  "dungeon-trap-plate": { textureKey: "craftpix.env.dungeon-trap-plate", path: "assets/craftpix/packs/dungeon-objects/trap_plate.png", columns: 7, frames: 105, label: "Dungeon trap plate" },
  "dungeon-trap-saw": { textureKey: "craftpix.env.dungeon-trap-saw", path: "assets/craftpix/packs/dungeon-objects/trap_saw.png", columns: 24, frames: 384, label: "Dungeon trap saw" },
} as const;

export type CraftpixEnvironmentSheetId = keyof typeof CRAFTPIX_ENVIRONMENT_SHEETS;
