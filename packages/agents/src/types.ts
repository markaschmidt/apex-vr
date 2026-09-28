import { z } from "zod";

/** High-level lifecycle for an embodied AI agent in a spatial scene. */
export const AgentPhaseSchema = z.enum([
  "idle",
  "listening",
  "thinking",
  "speaking",
  "acting",
  "confirming",
  "error",
]);
export type AgentPhase = z.infer<typeof AgentPhaseSchema>;

/**
 * Animation clips most agent runtimes should support out of the box.
 * `wave` / `nod` / `present` are additive gesture clips — never aliases of idle/work.
 */
export const AgentClipSchema = z.enum([
  "idle",
  "listen",
  "think",
  "talk",
  "walk",
  "work",
  "point",
  "celebrate",
  "error",
  "wave",
  "nod",
  "present",
  "dance",
]);
export type AgentClip = z.infer<typeof AgentClipSchema>;

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const AgentPoseSchema = z.object({
  position: Vec3Schema,
  rotationY: z.number().default(0),
});
export type AgentPose = z.infer<typeof AgentPoseSchema>;

/** Where the agent is in a locomotion cycle. Replicated on snapshots / Yjs. */
export const LocomotionSubstateSchema = z.enum([
  "orienting",
  "navigating",
  "attending",
]);
export type LocomotionSubstate = z.infer<typeof LocomotionSubstateSchema>;

/** Gaze policy after anchors resolve. Never a world-space vector on the wire. */
export const GazeHintSchema = z.enum(["primary", "cycle", "speaker", "none"]);
export type GazeHint = z.infer<typeof GazeHintSchema>;

/** When a plan step may start. v1 hosts should send `immediate` until VocalBridge playback events exist. */
export const AvatarCueSchema = z.enum(["immediate", "speech_start", "speech_end"]);
export type AvatarCue = z.infer<typeof AvatarCueSchema>;

export const GestureNameSchema = z.enum(["wave", "nod", "point", "present", "dance"]);
export type GestureName = z.infer<typeof GestureNameSchema>;

export const SetPhaseIntentSchema = z.object({
  type: z.literal("set_phase"),
  phase: AgentPhaseSchema,
});

export const SayIntentSchema = z.object({
  type: z.literal("say"),
  text: z.string().min(1),
  speak: z.boolean().default(true),
});

/** Local-only: walk toward a world point after the host resolved anchors. */
export const MoveToIntentSchema = z.object({
  type: z.literal("move_to"),
  position: Vec3Schema,
  lookAt: Vec3Schema.optional(),
});

export const PlayClipIntentSchema = z.object({
  type: z.literal("play_clip"),
  clip: AgentClipSchema,
});

export const FocusTargetIntentSchema = z.object({
  type: z.literal("focus_target"),
  targetId: z.string().min(1),
  stepId: z.string().min(1).optional(),
  cue: AvatarCueSchema.optional(),
});
export type FocusTargetIntent = z.infer<typeof FocusTargetIntentSchema>;

export const SetBusyIntentSchema = z.object({
  type: z.literal("set_busy"),
  active: z.boolean(),
  label: z.string().optional(),
});

export const CustomIntentSchema = z.object({
  type: z.literal("custom"),
  name: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

/**
 * Semantic attend. Host resolves `paneIds` through an injected anchor resolver,
 * then the controller applies local `move_to` + `focus_target`.
 */
export const AttendIntentSchema = z.object({
  type: z.literal("attend"),
  paneIds: z.array(z.string().min(1)).min(1),
  primaryPaneId: z.string().min(1),
  phaseHint: AgentPhaseSchema.optional(),
  clipHint: AgentClipSchema.optional(),
  gazeHint: GazeHintSchema.optional(),
  speechHint: z.string().optional(),
  stepId: z.string().min(1).optional(),
  cue: AvatarCueSchema.optional(),
});
export type AttendIntent = z.infer<typeof AttendIntentSchema>;

export const GestureIntentSchema = z.object({
  type: z.literal("gesture"),
  gesture: GestureNameSchema,
  paneId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  cue: AvatarCueSchema.optional(),
});
export type GestureIntent = z.infer<typeof GestureIntentSchema>;

export const CancelPlanIntentSchema = z.object({
  type: z.literal("cancel_plan"),
  planId: z.string().min(1).optional(),
  reason: z.string().optional(),
});
export type CancelPlanIntent = z.infer<typeof CancelPlanIntentSchema>;

/** Steps on a network plan: allowlisted types only; unknown `type` → blocked. */
export const PlanStepSchema = z
  .object({ type: z.string().min(1) })
  .passthrough();
export type PlanStep = z.infer<typeof PlanStepSchema>;

/**
 * Versioned network plan. `expiresAt`, `workspaceId`, and `actorId` stay required
 * so v1 fixtures and remote gates remain strict after camelCase normalization.
 */
export const ExecutePlanIntentSchema = z.object({
  type: z.literal("execute_plan"),
  planId: z.string().min(1),
  revision: z.number().int().positive(),
  expiresAt: z.string().min(1),
  workspaceId: z.string().min(1),
  actorId: z.string().min(1),
  steps: z.array(PlanStepSchema).min(1),
});
export type ExecutePlanIntent = z.infer<typeof ExecutePlanIntentSchema>;

/**
 * Transport-agnostic intents. Apps map voice, hands, text, or network events
 * into these before touching scene state.
 */
export const AgentIntentSchema = z.discriminatedUnion("type", [
  SetPhaseIntentSchema,
  SayIntentSchema,
  MoveToIntentSchema,
  PlayClipIntentSchema,
  FocusTargetIntentSchema,
  SetBusyIntentSchema,
  CustomIntentSchema,
  AttendIntentSchema,
  GestureIntentSchema,
  ExecutePlanIntentSchema,
  CancelPlanIntentSchema,
]);
export type AgentIntent = z.infer<typeof AgentIntentSchema>;

export interface AgentIdentity {
  id: string;
  displayName: string;
  /** Optional VRM / glTF URL. When omitted, use a procedural fallback. */
  avatarUrl?: string;
}

export interface AgentLocomotion {
  target: Vec3;
  lookAt?: Vec3;
}

export interface AgentWorkIndicator {
  active: boolean;
  label?: string;
}

export interface AgentSnapshot {
  identity: AgentIdentity;
  phase: AgentPhase;
  clip: AgentClip;
  pose: AgentPose;
  /** When set, AgentNPC walks toward `target` (capped per frame; no snap). */
  locomotion?: AgentLocomotion;
  workIndicator?: AgentWorkIndicator;
  focusTargetId?: string;
  lastUtterance?: string;
  updatedAt: number;
  planId?: string;
  revision?: number;
  locomotionSubstate?: LocomotionSubstate;
  blockedReason?: string;
  gazeHint?: GazeHint;
  gazeTargetId?: string;
  secondaryFocusIds?: string[];
  /** Last mic/job/TTS presence; independent of locomotion. */
  presence?: AgentPhase;
  /** Active one-shot gesture, if any. Not a Yjs field. */
  gestureName?: GestureName;
  /** Mixer `finished` must echo this or the event is ignored. */
  gestureGeneration?: number;
}

export type AgentListener = (snapshot: AgentSnapshot) => void;

/** Default phase → clip mapping. Override per product if needed. */
export const DEFAULT_PHASE_CLIPS: Record<AgentPhase, AgentClip> = {
  idle: "idle",
  listening: "listen",
  thinking: "think",
  speaking: "talk",
  acting: "walk",
  confirming: "celebrate",
  error: "error",
};

export const PRESENCE_PHASES = [
  "idle",
  "listening",
  "thinking",
  "speaking",
] as const satisfies readonly AgentPhase[];
export type PresencePhase = (typeof PRESENCE_PHASES)[number];
