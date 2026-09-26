import { PRESENCE_PHASES, type AgentClip, type AgentPhase, type AgentSnapshot, type PresencePhase, type Vec3 } from "../types.js";
import type { NetworkPlanStep } from "../embodiment/validate.js";
import type { ActiveGesture } from "./types.js";

export const ARRIVAL_THRESHOLD = 0.08;
/** In-place turn only for about-faces; typical side steps navigate immediately. */
export const ORIENT_THRESHOLD = Math.PI * 0.6;
/** Cap a hitch so one frame cannot skip the whole walk (looks like a teleport). */
export const MAX_LOCOMOTION_DELTA = 1 / 20;
export const MAX_CLOCK_DELTA = 1;
export const GESTURE_MAX_SEC = 4;
export const GESTURE_DEFAULT_SEC = 1.25;
export const DEFAULT_CUE_TIMEOUT_MS = 8000;
export const DEFAULT_GAZE_CYCLE_SEC = 2.5;
export const MAX_STEP_CHAIN = 24;

export function isPresencePhase(phase: AgentPhase): phase is PresencePhase {
  return (PRESENCE_PHASES as readonly string[]).includes(phase);
}

/** rotationY 0 faces world -Z (VRM meshes add π). atan2(dx, dz) would face +Z. */
export function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(from[0] - to[0], from[2] - to[2]);
}

export function shortestAngle(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

export function extraActual(
  snapshot: AgentSnapshot,
  fallback?: string,
): string | undefined {
  return fallback ?? snapshot.focusTargetId;
}

export function extraTargetFromStep(step: NetworkPlanStep | undefined): string | undefined {
  if (!step) return undefined;
  if (step.type === "attend") return step.primaryPaneId;
  if (step.type === "focus_target") return step.targetId;
  return step.paneId;
}

export function stepTarget(
  step: NetworkPlanStep | undefined,
  focusTargetId: string | undefined,
): string | undefined {
  if (!step) return focusTargetId;
  if (step.type === "attend") return step.primaryPaneId;
  if (step.type === "focus_target") return step.targetId;
  return step.paneId ?? focusTargetId;
}

export function motorsBusy(
  next: AgentSnapshot,
  activeGesture: ActiveGesture | null,
  sequencerActive: boolean,
): boolean {
  return Boolean(next.locomotion || activeGesture || sequencerActive);
}

export function clipForStanding(input: {
  next: AgentSnapshot;
  activeGesture: ActiveGesture | null;
  presence: PresencePhase;
  phaseClips: Record<AgentPhase, AgentClip>;
}): AgentClip {
  const { next, activeGesture, presence, phaseClips } = input;
  if (activeGesture) return activeGesture.clip;
  if (next.phase === "acting") {
    return presence === "idle" ? "idle" : phaseClips[presence];
  }
  return phaseClips[next.phase];
}

export function deriveClip(input: {
  next: AgentSnapshot;
  activeGesture: ActiveGesture | null;
  presence: PresencePhase;
  phaseClips: Record<AgentPhase, AgentClip>;
}): AgentClip {
  const { next, activeGesture, presence, phaseClips } = input;
  if (activeGesture) return activeGesture.clip;
  if (next.locomotion && next.locomotionSubstate === "navigating") return "walk";
  if (next.locomotion && next.locomotionSubstate === "orienting") {
    return presence === "idle" ? "idle" : phaseClips[presence];
  }
  return clipForStanding(input);
}
