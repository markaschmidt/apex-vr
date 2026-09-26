import {
  supportedGestures,
  type LoadedPlaybackInfo,
} from "../avatar/gestures.js";
import type { AgentClip, GazeHint, GestureName } from "../types.js";

export const BASE_CAPABILITY_IDS = [
  "avatar.plan.v2",
  "locomotion.attend",
  "focus_target",
] as const;

export interface AgentRuntimeCapabilities {
  /** Capability strings for host `agent-context` (never Mixamo URL maps). */
  ids: readonly string[];
  clips: readonly string[];
  gestures: readonly GestureName[];
  gaze: readonly GazeHint[];
  lookAt: boolean;
}

export function buildRuntimeCapabilities(input: {
  playback: LoadedPlaybackInfo | null;
}): AgentRuntimeCapabilities {
  const clips = input.playback?.clips.map((clip) => clip.name) ?? [];
  const gestures = supportedGestures(input.playback);
  const lookAt = Boolean(input.playback?.lookAt);
  const gaze: GazeHint[] = lookAt
    ? ["primary", "cycle", "speaker", "none"]
    : ["primary", "cycle", "none"];
  const ids: string[] = [...BASE_CAPABILITY_IDS];
  if (lookAt) ids.push("gaze.speaker");
  for (const gesture of gestures) ids.push(`gesture.${gesture}`);
  return { ids, clips, gestures, gaze, lookAt };
}

export function capabilityIdSet(
  capabilities: AgentRuntimeCapabilities,
): Set<string> {
  return new Set(capabilities.ids);
}

export function isGestureCapability(
  capabilities: AgentRuntimeCapabilities,
  gesture: GestureName,
): boolean {
  return capabilities.gestures.includes(gesture);
}

export function loadedClipNames(
  capabilities: AgentRuntimeCapabilities,
): ReadonlySet<string> {
  return new Set(capabilities.clips as AgentClip[]);
}
