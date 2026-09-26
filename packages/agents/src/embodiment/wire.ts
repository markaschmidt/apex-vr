import {
  AgentIntentSchema,
  AttendIntentSchema,
  CancelPlanIntentSchema,
  ExecutePlanIntentSchema,
  FocusTargetIntentSchema,
  GestureIntentSchema,
  type AgentIntent,
  type AttendIntent,
  type CancelPlanIntent,
  type ExecutePlanIntent,
  type GestureIntent,
} from "../types.js";
import { asRecord, pickNumber, pickString } from "./json.js";

const REMOTE_INTENT_TYPES = new Set([
  "attend",
  "execute_plan",
  "cancel_plan",
  "focus_target",
]);

export function isRemoteIntentType(type: string): boolean {
  return REMOTE_INTENT_TYPES.has(type);
}

function camelFromSnakeKey(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function mapKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapKeys);
  const record = asRecord(value);
  if (!record) return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(record)) {
    out[camelFromSnakeKey(key)] = mapKeys(nested);
  }
  return out;
}

function optionalCue(raw: Record<string, unknown>): unknown {
  return raw.cue;
}

function attendFromUnknown(raw: Record<string, unknown>): AttendIntent | null {
  const paneIds = Array.isArray(raw.paneIds)
    ? raw.paneIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const primary = pickString(raw, "primaryPaneId") ?? paneIds[0] ?? "";
  const candidate = {
    type: "attend" as const,
    paneIds: paneIds.length ? paneIds : primary ? [primary] : [],
    primaryPaneId: primary,
    phaseHint: raw.phaseHint,
    clipHint: raw.clipHint,
    gazeHint: raw.gazeHint,
    speechHint: typeof raw.speechHint === "string" ? raw.speechHint : undefined,
    stepId: pickString(raw, "stepId"),
    cue: optionalCue(raw),
  };
  const parsed = AttendIntentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function executePlanFromUnknown(
  raw: Record<string, unknown>,
): ExecutePlanIntent | null {
  const steps = Array.isArray(raw.steps) ? raw.steps : [];
  const candidate = {
    type: "execute_plan" as const,
    planId: pickString(raw, "planId") ?? "",
    revision: pickNumber(raw, "revision") ?? 0,
    expiresAt: pickString(raw, "expiresAt") ?? "",
    workspaceId: pickString(raw, "workspaceId") ?? "",
    actorId: pickString(raw, "actorId") ?? "",
    steps,
  };
  const parsed = ExecutePlanIntentSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function cancelFromUnknown(raw: Record<string, unknown>): CancelPlanIntent | null {
  const parsed = CancelPlanIntentSchema.safeParse({
    type: "cancel_plan",
    planId: pickString(raw, "planId"),
    reason: pickString(raw, "reason"),
  });
  return parsed.success ? parsed.data : null;
}

function focusFromUnknown(raw: Record<string, unknown>): AgentIntent | null {
  const parsed = FocusTargetIntentSchema.safeParse({
    type: "focus_target",
    targetId: pickString(raw, "targetId") ?? pickString(raw, "primaryPaneId") ?? "",
    stepId: pickString(raw, "stepId"),
    cue: optionalCue(raw),
  });
  return parsed.success ? parsed.data : null;
}

function gestureFromUnknown(raw: Record<string, unknown>): GestureIntent | null {
  const parsed = GestureIntentSchema.safeParse({
    type: "gesture",
    gesture: pickString(raw, "gesture") ?? "",
    paneId: pickString(raw, "paneId"),
    stepId: pickString(raw, "stepId"),
    cue: optionalCue(raw),
  });
  return parsed.success ? parsed.data : null;
}

function intentFromRecord(raw: Record<string, unknown>): AgentIntent | null {
  const type = pickString(raw, "type") ?? pickString(raw, "eventType");
  if (type === "attend") return attendFromUnknown(raw);
  if (type === "execute_plan" || type === "embodiment_plan") {
    return executePlanFromUnknown(
      type === "embodiment_plan" ? { ...raw, type: "execute_plan" } : raw,
    );
  }
  if (type === "cancel_plan" || type === "embodiment_cancel") {
    return cancelFromUnknown({ ...raw, type: "cancel_plan" });
  }
  if (type === "focus_target") return focusFromUnknown(raw);
  if (type === "gesture") return gestureFromUnknown(raw);
  const parsed = AgentIntentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Map a Vektral SSE / command-response envelope (snake_case or camelCase)
 * onto a camelCase `AgentIntent`. Returns null when the payload is not an
 * embodiment intent. Coordinates never belong on this path.
 */
export function apexIntentFromWire(payload: unknown): AgentIntent | null {
  const root = asRecord(payload);
  if (!root) return null;

  const nested =
    asRecord(root.apexIntent) ??
    asRecord(root.apex_intent) ??
    asRecord(root.embodimentJson) ??
    asRecord(root.embodiment_json);

  const camelRoot = asRecord(mapKeys(root)) ?? {};
  const camelNested = nested ? asRecord(mapKeys(nested)) : undefined;
  const source = camelNested ?? camelRoot;

  return intentFromRecord(source);
}

/** Strict parse for already-camelCase controller input. */
export function parseAgentIntent(payload: unknown): AgentIntent {
  return AgentIntentSchema.parse(payload);
}
