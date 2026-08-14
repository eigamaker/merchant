export interface CraftpixAnimationFrame {
  frame: number;
  duration: number;
}

export interface CraftpixAnimationClip {
  id: string;
  sheet: string;
  representative: number;
  frames: CraftpixAnimationFrame[];
  loop: boolean;
}

export interface CraftpixAnimationCatalog {
  version: number;
  tile: 16;
  clips: CraftpixAnimationClip[];
}

export const CRAFTPIX_ANIMATION_CATALOG_PATH = "assets/dungeons/craftpix-animation-catalog.json";

export function animationClip(catalog: CraftpixAnimationCatalog | undefined, id: string | undefined): CraftpixAnimationClip | undefined {
  return catalog?.clips.find((clip) => clip.id === id);
}

export function animationClipsForSheet(catalog: CraftpixAnimationCatalog | undefined, sheet: string): CraftpixAnimationClip[] {
  return catalog?.clips.filter((clip) => clip.sheet === sheet) ?? [];
}
