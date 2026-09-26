import {
  AttendIntentSchema,
  FocusTargetIntentSchema,
  GestureIntentSchema,
  type AttendIntent,
  type ExecutePlanIntent,
  type FocusTargetIntent,
  type GestureIntent,
  type PlanStep,
} from "../types.js";
import type { AnchorResolver, PaneAnchor } from "./anchors.js";
import { PlanBlockReason } from "./events.js";

/** Parseable network step types. Gesture still capability-gated at execute time. */
export const NETWORK_STEP_TYPES = new Set(["attend", "focus_target", "gesture"]);

export type NetworkPlanStep = AttendIntent | FocusTargetIntent | GestureIntent;

export type PlanGateFailure = {
  reason: (typeof PlanBlockReason)[keyof typeof PlanBlockReason];
};

export function planExpired(expiresAt: string, nowMs = Date.now()): boolean {
  const expires = Date.parse(expiresAt);
  return Number.isNaN(expires) || expires <= nowMs;
}

export function parseNetworkStep(step: PlanStep): NetworkPlanStep | null {
  if (step.type === "attend") {
    const parsed = AttendIntentSchema.safeParse(step);
    return parsed.success ? parsed.data : null;
  }
  if (step.type === "focus_target") {
    const parsed = FocusTargetIntentSchema.safeParse(step);
    return parsed.success ? parsed.data : null;
  }
  if (step.type === "gesture") {
    const parsed = GestureIntentSchema.safeParse(step);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

export function paneIdsForStep(step: NetworkPlanStep): string[] {
  if (step.type === "focus_target") return [step.targetId];
  if (step.type === "gesture") return step.paneId ? [step.paneId] : [];
  const ids = new Set(step.paneIds);
  ids.add(step.primaryPaneId);
  return [...ids];
}

export function resolvePaneIds(
  paneIds: readonly string[],
  resolveAnchor: AnchorResolver | undefined,
): { anchors: PaneAnchor[]; failed: string[] } {
  if (!resolveAnchor) {
    return { anchors: [], failed: [...paneIds] };
  }
  const anchors: PaneAnchor[] = [];
  const failed: string[] = [];
  for (const paneId of paneIds) {
    const anchor = resolveAnchor(paneId);
    if (!anchor) {
      failed.push(paneId);
      continue;
    }
    anchors.push({
      paneId,
      position: anchor.position,
      lookAt: anchor.lookAt,
    });
  }
  return { anchors, failed };
}

export function gateExecutePlan(
  plan: ExecutePlanIntent,
  options: {
    workspaceId?: string;
    actorId?: string;
    lastRevision: number;
    nowMs?: number;
  },
): PlanGateFailure | null {
  if (plan.revision <= options.lastRevision) {
    return { reason: PlanBlockReason.staleRevision };
  }
  if (planExpired(plan.expiresAt, options.nowMs)) {
    return { reason: PlanBlockReason.expiredPlan };
  }
  if (options.workspaceId && options.workspaceId !== plan.workspaceId) {
    return { reason: PlanBlockReason.workspaceMismatch };
  }
  if (options.actorId && options.actorId !== plan.actorId) {
    return { reason: PlanBlockReason.actorMismatch };
  }
  return null;
}
