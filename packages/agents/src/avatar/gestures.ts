import type { AnimationClip } from "three";
import type { AgentClip, GestureName } from "../types.js";

export const GESTURE_NAMES: readonly GestureName[] = [
  "wave",
  "nod",
  "point",
  "present",
];

/**
 * Semantic gesture → logical clip. `nod` and `present` have no idle/work alias:
 * missing dedicated clips are `unsupported_capability`, never a silent fallback.
 */
export const GESTURE_CLIP_CANDIDATES: Record<GestureName, readonly string[]> = {
  wave: ["wave", "talk"],
  nod: ["nod"],
  point: ["point"],
  present: ["present"],
};

const LOOPING_CLIPS = new Set<string>([
  "idle",
  "listen",
  "think",
  "walk",
  "work",
  "celebrate",
]);

export interface LoadedClipInfo {
  name: string;
  duration: number;
  /** True when this is not an idle/work/listen alias and not a looping presence clip. */
  dedicatedLoopOnce: boolean;
}

export interface LoadedPlaybackInfo {
  clips: LoadedClipInfo[];
  lookAt: boolean;
}

export function clipsEquivalent(a: AnimationClip, b: AnimationClip): boolean {
  if (Math.abs(a.duration - b.duration) > 1e-4) return false;
  if (a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((track, index) => {
    const other = b.tracks[index];
    return Boolean(
      other &&
        track.name === other.name &&
        track.times.length === other.times.length,
    );
  });
}

export function inspectLoadedClips(
  actions: Iterable<[string, { getClip(): AnimationClip }]>,
): LoadedClipInfo[] {
  const entries = [...actions];
  const idle = entries.find(([name]) => name === "idle")?.[1]?.getClip();
  return entries.map(([name, action]) => {
    const clip = action.getClip();
    const aliasedIdle = Boolean(idle && clipsEquivalent(clip, idle));
    const loopingKind = LOOPING_CLIPS.has(name);
    return {
      name,
      duration: clip.duration,
      dedicatedLoopOnce: !aliasedIdle && !loopingKind,
    };
  });
}

export function resolveGestureClip(
  gesture: GestureName,
  playback: LoadedPlaybackInfo | null | undefined,
): { name: AgentClip; duration: number } | null {
  if (!playback) return null;
  const byName = new Map(playback.clips.map((clip) => [clip.name, clip]));
  for (const candidate of GESTURE_CLIP_CANDIDATES[gesture]) {
    const info = byName.get(candidate);
    if (!info?.dedicatedLoopOnce) continue;
    return { name: candidate as AgentClip, duration: info.duration };
  }
  return null;
}

export function supportedGestures(
  playback: LoadedPlaybackInfo | null | undefined,
): GestureName[] {
  return GESTURE_NAMES.filter((name) => resolveGestureClip(name, playback));
}
