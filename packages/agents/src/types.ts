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

/** Animation clips most agent runtimes should support out of the box. */
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
]);
export type AgentClip = z.infer<typeof AgentClipSchema>;

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export type Vec3 = z.infer<typeof Vec3Schema>;

export const AgentPoseSchema = z.object({
  position: Vec3Schema,
  rotationY: z.number().default(0),
});
export type AgentPose = z.infer<typeof AgentPoseSchema>;

/**
 * Transport-agnostic intents. Apps map voice, hands, text, or network events
 * into these before touching scene state.
 */
export const AgentIntentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_phase"), phase: AgentPhaseSchema }),
  z.object({
    type: z.literal("say"),
    text: z.string().min(1),
    speak: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("move_to"),
    position: Vec3Schema,
    lookAt: Vec3Schema.optional(),
  }),
  z.object({ type: z.literal("play_clip"), clip: AgentClipSchema }),
  z.object({
    type: z.literal("focus_target"),
    targetId: z.string().min(1),
  }),
  z.object({
    type: z.literal("set_busy"),
    active: z.boolean(),
    label: z.string().optional(),
  }),
  z.object({
    type: z.literal("custom"),
    name: z.string().min(1),
    payload: z.record(z.unknown()).optional(),
  }),
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
  /** When set, the renderer walks toward `target` instead of snapping pose. */
  locomotion?: AgentLocomotion;
  workIndicator?: AgentWorkIndicator;
  focusTargetId?: string;
  lastUtterance?: string;
  updatedAt: number;
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
