import type { ActorDirection, CraftpixActorClip, CraftpixActorDefinition } from "../game/craftpixActors";

export interface ActorPreviewState {
  action: string;
  direction: ActorDirection;
  frame: number;
  elapsedMs: number;
}

export function actorPreviewActions(actor: CraftpixActorDefinition | undefined): string[] {
  return actor ? Object.keys(actor.clips).filter((action) => Boolean(actor.clips[action as keyof typeof actor.clips])) : [];
}

export function actorPreviewDirections(clip: CraftpixActorClip | undefined): ActorDirection[] {
  return clip ? [...clip.directions] : ["down"];
}

export function actorPreviewFrameRect(clip: CraftpixActorClip, direction: ActorDirection, frame: number): { sx: number; sy: number; width: number; height: number } {
  const safeFrame = Math.max(0, Math.min(clip.columns - 1, Math.floor(frame)));
  const row = Math.max(0, clip.directions.indexOf(direction));
  return { sx: safeFrame * clip.frameWidth, sy: row * clip.frameHeight, width: clip.frameWidth, height: clip.frameHeight };
}

export function advanceActorPreview(state: ActorPreviewState, clip: CraftpixActorClip, elapsedMs: number): ActorPreviewState {
  const frameCount = Math.max(1, clip.columns);
  const frame = Math.max(0, Math.min(frameCount - 1, state.frame));
  const frameDuration = Math.max(1, clip.durationsMs?.[frame] ?? 1000 / Math.max(0.1, clip.frameRate || 1));
  let elapsed = state.elapsedMs + Math.max(0, elapsedMs);
  let nextFrame = frame;
  while (elapsed >= frameDuration) {
    elapsed -= frameDuration;
    nextFrame = (nextFrame + 1) % frameCount;
  }
  return { ...state, frame: nextFrame, elapsedMs: elapsed };
}

export function actorPreviewPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}
