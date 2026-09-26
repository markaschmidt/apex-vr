import type { AgentClip, AgentPhase, AgentSnapshot, GestureName, PresencePhase } from "../types.js";
import type { ActiveGesture } from "./types.js";
import { GESTURE_DEFAULT_SEC, GESTURE_MAX_SEC, clipForStanding } from "./utils.js";

export function openGesture(input: {
  snapshot: AgentSnapshot;
  name: GestureName;
  clip: AgentClip;
  duration: number;
  generation: number;
}): { active: ActiveGesture; generation: number; snapshot: AgentSnapshot } {
  const generation = input.generation + 1;
  const remainingSec = Math.min(
    input.duration > 0.05 ? input.duration : GESTURE_DEFAULT_SEC,
    GESTURE_MAX_SEC,
  );
  const active: ActiveGesture = {
    name: input.name,
    clip: input.clip,
    generation,
    remainingSec,
  };
  return {
    active,
    generation,
    snapshot: {
      ...input.snapshot,
      clip: input.clip,
      gestureName: input.name,
      gestureGeneration: generation,
      updatedAt: Date.now(),
      blockedReason: undefined,
    },
  };
}

export function closeGesture(input: {
  snapshot: AgentSnapshot;
  generation: number;
  presence: PresencePhase;
  phaseClips: Record<AgentPhase, AgentClip>;
}): { generation: number; snapshot: AgentSnapshot } {
  const generation = input.generation + 1;
  const snapshot: AgentSnapshot = {
    ...input.snapshot,
    gestureName: undefined,
    gestureGeneration: generation,
    updatedAt: Date.now(),
  };
  snapshot.clip = clipForStanding({
    next: snapshot,
    activeGesture: null,
    presence: input.presence,
    phaseClips: input.phaseClips,
  });
  return { generation, snapshot };
}

export function decayGesture(
  active: ActiveGesture,
  clockDt: number,
): { active: ActiveGesture; finished: boolean } {
  const remainingSec = active.remainingSec - clockDt;
  return {
    active: { ...active, remainingSec },
    finished: remainingSec <= 0,
  };
}
