import type { GazeHint, Vec3 } from "../types.js";
import type { AnchorResolver } from "./anchors.js";

export function selectGazeTargetId(input: {
  hint?: GazeHint;
  primaryPaneId?: string;
  cycleIds?: readonly string[];
  cycleIndex?: number;
  speakerTargetId?: string;
}): string | undefined {
  if (input.hint === "none") return undefined;
  if (input.hint === "speaker") {
    return input.speakerTargetId ?? input.primaryPaneId;
  }
  if (input.hint === "cycle") {
    const ids = input.cycleIds ?? [];
    if (!ids.length) return input.primaryPaneId;
    const index = Math.abs(input.cycleIndex ?? 0) % ids.length;
    return ids[index] ?? input.primaryPaneId;
  }
  return input.primaryPaneId;
}

/**
 * Local world point the VRM look-at should track. Never put this on the wire.
 * Prefers pane `lookAt`, then stand `position`, then an explicit speaker point.
 */
export function resolveGazeWorldPoint(input: {
  hint?: GazeHint;
  targetId?: string;
  speakerLookAt?: Vec3;
  resolveAnchor?: AnchorResolver;
}): Vec3 | undefined {
  if (input.hint === "none") return undefined;
  if (input.hint === "speaker" && input.speakerLookAt) {
    return input.speakerLookAt;
  }
  if (!input.targetId || !input.resolveAnchor) {
    return input.hint === "speaker" ? input.speakerLookAt : undefined;
  }
  const anchor = input.resolveAnchor(input.targetId);
  if (!anchor) return input.speakerLookAt;
  return anchor.lookAt ?? anchor.position;
}
