export const PlanEventStatus = {
  accepted: "accepted",
  running: "running",
  completed: "completed",
  blocked: "blocked",
  cancelled: "cancelled",
} as const;

export type PlanEventStatus =
  (typeof PlanEventStatus)[keyof typeof PlanEventStatus];

/** Reasons the controller reports on `blocked` / `cancelled` receipts. */
export const PlanBlockReason = {
  unknownAction: "unknown_action",
  unresolvedPane: "unresolved_pane",
  missingResolver: "missing_resolver",
  expiredPlan: "expired_plan",
  staleRevision: "stale_revision",
  actorMismatch: "actor_mismatch",
  workspaceMismatch: "workspace_mismatch",
  destinationTimeout: "destination_timeout",
  userOverride: "user_override",
  cueTimeout: "cue_timeout",
  unsupportedCapability: "unsupported_capability",
} as const;

export type PlanBlockReason =
  (typeof PlanBlockReason)[keyof typeof PlanBlockReason];

/** `unsupported_capability:gesture.wave` — never a silent idle fallback. */
export function unsupportedCapabilityReason(feature: string): string {
  return `${PlanBlockReason.unsupportedCapability}:${feature}`;
}

/**
 * Receipt payload for the host to POST to Vektral.
 * APEX never performs HTTP. `stepId` / `stepIndex` are optional diagnostics.
 * Listeners that only read v1 fields stay source-compatible.
 */
export interface PlanEvent {
  status: PlanEventStatus;
  planId?: string;
  revision?: number;
  actualTarget?: string;
  reason?: string;
  contextRevision?: number;
  stepId?: string;
  stepIndex?: number;
}

export type PlanEventListener = (event: PlanEvent) => void;

export function embodimentDedupeKey(planId: string, revision: number): string {
  return `${planId}:${revision}`;
}
