import type { AnchorResolver } from "../embodiment/anchors.js";
import type { PlanEventListener } from "../embodiment/events.js";
import type {
  AgentClip,
  AgentIdentity,
  AgentPhase,
  AgentPose,
  GestureName,
} from "../types.js";

export interface AgentControllerOptions {
  identity: AgentIdentity;
  initialPose?: AgentPose;
  phaseClips?: Partial<Record<AgentPhase, AgentClip>>;
  /** World-units per second when walking toward a move target. */
  walkSpeed?: number;
  /** Radians per second while turning in place before a walk. */
  turnSpeed?: number;
  /** Host pane_id → stand pose. Required for `attend` / remote plans. */
  resolveAnchor?: AnchorResolver;
  /** Host forwards these to Vektral `/embodiment/receipts`. */
  onPlanEvent?: PlanEventListener;
  workspaceId?: string;
  actorId?: string;
  /** Abort in-progress locomotion after this many ms of simulation time. */
  destinationTimeoutMs?: number;
  /** Skip a cued step (and the remainder) if the host never signals. */
  cueTimeoutMs?: number;
  /** Seconds between gaze.cycle target hops. */
  gazeCycleSec?: number;
}

export type IntentSource = "local" | "remote";
export type CompletionKind = "plan" | "local" | null;

export type ActiveGesture = {
  name: GestureName;
  clip: AgentClip;
  generation: number;
  remainingSec: number;
};
