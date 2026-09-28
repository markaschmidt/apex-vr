/**
 * Typed voice tools. The host forwards the agent's tool object and paints
 * only what this POST confirms. It does not interpret the user's sentence.
 */

export const VOICE_TOOL_ACTIONS = [
  "open_pane",
  "load_page",
  "set_pane_content",
  "rename_pane",
  "close_pane",
  "edit_page",
  "create_page",
  "attend_pane",
  "perform",
  "research",
  "linear",
  "chat_session",
  "restart_preview",
  "deploy_site",
  "undo_edit",
  "cancel_job",
  "interact_page",
  "run_sequence",
] as const;

export type VoiceToolAction = (typeof VOICE_TOOL_ACTIONS)[number];

const TOOL_ACTION_SET = new Set<string>(VOICE_TOOL_ACTIONS);

export function isVoiceToolAction(action: string): action is VoiceToolAction {
  return TOOL_ACTION_SET.has(action);
}

export type VoicePaneKind = "preview" | "blank" | "chat";

export type WorkspaceStatePaneInput = {
  id: string;
  title?: string;
  route?: string;
  kind?: string;
};

export type WorkspaceStatePane = {
  id: string;
  title: string;
  route: string;
  kind: VoicePaneKind;
  selected: boolean;
  primary: boolean;
};

export type VoiceSelection = {
  primaryPaneId?: string;
  focusedPaneIds?: readonly string[];
  contextRevision?: number;
};

export type VoiceClarify = {
  question: string;
  candidates: { id: string; title: string }[];
};

export type VoiceActionResponse = {
  turn_id?: string;
  ok?: boolean;
  say?: string;
  agent_response?: string;
  duplicate?: boolean;
  status?: string;
  clarify?: VoiceClarify | null;
  result_json?: unknown;
  actions?: unknown;
  spawned_panes?: unknown;
  updated_panes?: unknown;
  job_ids?: unknown;
  avatar_plan?: unknown;
  warnings?: unknown;
};

export type ActionResultForAgent = {
  turn_id: string;
  ok: boolean;
  say: string;
  clarify?: VoiceClarify;
};

export type PostVoiceActionArgs = {
  apiBase: string;
  workspaceId: string;
  turnId: string;
  /** Tool object exactly as the agent sent it, including run_sequence.steps. */
  call: Record<string, unknown>;
  /** Last finalized user transcript, verbatim. */
  utterance: string;
  selection: VoiceSelection;
  getToken: () => string | null | Promise<string | null>;
  /** Called at most once, and only after a 401. */
  refreshToken: () => string | null | Promise<string | null>;
};

function joinApiBase(apiBase: string): string {
  return apiBase.trim().replace(/\/$/, "");
}

export function workspaceStateKind(kind: string | undefined): VoicePaneKind {
  if (kind === "blank") return "blank";
  if (kind === "chat") return "chat";
  return "preview";
}

/** Panes on screen. selected/primary are clicks only. */
export function buildWorkspaceState(
  panes: readonly WorkspaceStatePaneInput[],
  selection: VoiceSelection = {},
): { panes: WorkspaceStatePane[] } {
  const primary = selection.primaryPaneId?.trim() ?? "";
  const focused = new Set(
    (selection.focusedPaneIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  return {
    panes: panes.map((pane) => ({
      id: pane.id,
      title: pane.title ?? "",
      route: pane.route ?? "",
      kind: workspaceStateKind(pane.kind),
      selected: pane.id === primary || focused.has(pane.id),
      primary: Boolean(primary) && pane.id === primary,
    })),
  };
}

function clarifyFrom(value: unknown): VoiceClarify | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { question?: unknown; candidates?: unknown };
  if (typeof record.question !== "string" || !record.question.trim()) return undefined;
  const candidates = Array.isArray(record.candidates)
    ? record.candidates
        .filter((item): item is { id?: unknown; title?: unknown } =>
          Boolean(item) && typeof item === "object",
        )
        .filter((item) => typeof item.id === "string" && item.id.length > 0)
        .map((item) => ({
          id: String(item.id),
          title: typeof item.title === "string" ? item.title : "",
        }))
    : [];
  return { question: record.question, candidates };
}

/** What Nova is allowed to speak. Omits clarify when nothing needs a choice. */
export function actionResultForAgent(
  response: VoiceActionResponse,
  fallbackTurnId: string,
): ActionResultForAgent {
  const clarify = clarifyFrom(response.clarify);
  return {
    turn_id: response.turn_id?.trim() || fallbackTurnId,
    ok: response.ok !== false,
    say: (response.say ?? response.agent_response ?? "").trim(),
    ...(clarify ? { clarify } : {}),
  };
}

const TOOL_FIELDS: Record<string, readonly string[]> = {
  open_pane: ["turn_id", "kind", "title", "route", "url"],
  load_page: ["turn_id", "target", "route", "url", "title"],
  set_pane_content: ["turn_id", "target", "kind", "route", "url"],
  rename_pane: ["turn_id", "target", "title"],
  close_pane: ["turn_id", "target"],
  edit_page: ["turn_id", "target", "instruction"],
  create_page: ["turn_id", "title", "route", "instruction"],
  attend_pane: ["turn_id", "target", "gesture"],
  perform: ["turn_id", "emote", "target"],
  research: ["turn_id", "query"],
  linear: ["turn_id", "instruction"],
  chat_session: ["turn_id", "op", "title"],
  restart_preview: ["turn_id", "target"],
  deploy_site: ["turn_id"],
  undo_edit: ["turn_id", "target"],
  cancel_job: ["turn_id", "scope"],
  interact_page: ["turn_id", "target", "steps"],
  run_sequence: ["turn_id", "steps"],
};

const TARGET_REFS = new Set(["selected", "primary", "all_selected", "last_created"]);
const PANE_KINDS = new Set(["blank", "page", "url", "chat"]);
const EMOTES = new Set(["dance", "wave", "nod", "point", "present"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A target is exactly one of pane_id, ref, or name. */
export function normalizePaneTarget(value: unknown): Record<string, string> | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return undefined;
    if (text.startsWith("pane_")) return { pane_id: text };
    if (TARGET_REFS.has(text)) return { ref: text };
    return { name: text };
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const paneId = asTrimmed(record.pane_id) || asTrimmed(record.paneId);
  if (paneId) return { pane_id: paneId };
  const ref = asTrimmed(record.ref);
  if (TARGET_REFS.has(ref)) return { ref };
  const name = asTrimmed(record.name) || asTrimmed(record.title);
  if (name) return { name };
  return undefined;
}

function normalizeKind(value: unknown): string {
  const kind = asTrimmed(value).toLowerCase();
  if (kind === "preview") return "page";
  if (kind === "external") return "url";
  return PANE_KINDS.has(kind) ? kind : "";
}

function toolName(record: Record<string, unknown>, fallback: string): string {
  return (
    asTrimmed(record.action) ||
    asTrimmed(record.type) ||
    asTrimmed(record.name) ||
    asTrimmed(record.tool) ||
    fallback
  );
}

function flattenTool(record: Record<string, unknown>): Record<string, unknown> {
  const nested =
    asRecord(record.arguments) ??
    asRecord(record.args) ??
    asRecord(record.input) ??
    asRecord(record.parameters);
  return nested ? { ...record, ...nested } : { ...record };
}

/**
 * Keep the documented tool fields. Extra keys (and a buried `arguments`
 * object) are what makes the API answer 422 and paint nothing.
 */
export function normalizeVoiceCall(
  raw: Record<string, unknown>,
  fallbackAction = "",
): Record<string, unknown> {
  const flat = flattenTool(raw);
  const action = toolName(flat, fallbackAction);
  if (action === "run_sequence") {
    const steps = Array.isArray(flat.steps) ? flat.steps : [];
    return {
      tool: action,
      ...(asTrimmed(flat.turn_id) ? { turn_id: asTrimmed(flat.turn_id) } : {}),
      steps: steps
        .map((step) => asRecord(step))
        .filter((step): step is Record<string, unknown> => Boolean(step))
        .map((step) => {
          const normalized = normalizeVoiceCall(step, toolName(step, ""));
          if (normalized.tool === "run_sequence" || normalized.tool === "cancel_job") return null;
          if (step.depends_on != null) normalized.depends_on = step.depends_on;
          return normalized;
        })
        .filter((step): step is Record<string, unknown> => Boolean(step)),
    };
  }
  const fields = TOOL_FIELDS[action];
  if (!fields) {
    const { action: _action, type: _type, name: _name, tool: _tool, ...rest } = flat;
    return { tool: action, ...rest };
  }
  const call: Record<string, unknown> = { tool: action };
  for (const field of fields) {
    const value = flat[field];
    if (field === "target") {
      const target = normalizePaneTarget(value);
      if (target) call.target = target;
      continue;
    }
    if (field === "kind") {
      const kind = normalizeKind(value);
      if (kind) call.kind = kind;
      continue;
    }
    if (field === "gesture") {
      const gesture = asTrimmed(value);
      if (gesture === "" || EMOTES.has(gesture)) call.gesture = gesture;
      continue;
    }
    if (field === "emote") {
      const emote = asTrimmed(value);
      if (EMOTES.has(emote)) call.emote = emote;
      continue;
    }
    if (field === "op") {
      const op = asTrimmed(value);
      if (op === "new" || op === "switch") call.op = op;
      continue;
    }
    if (field === "scope") {
      const scope = asTrimmed(value);
      if (scope === "last" || scope === "all") call.scope = scope;
      continue;
    }
    if (field === "steps" && Array.isArray(value)) {
      call.steps = value;
      continue;
    }
    if (typeof value === "string") {
      if (field === "instruction" || field === "query" || value.trim()) {
        call[field] = field === "instruction" || field === "query" ? value : value.trim();
      }
      continue;
    }
    if (value != null && field !== "steps") call[field] = value;
  }
  if (!call.target) {
    const target = normalizePaneTarget(flat.pane_id ?? flat.paneId ?? flat.ref ?? flat.name);
    if (target && fields.includes("target")) call.target = target;
  }
  return call;
}

export function formatVoiceActionError(status: number, body: unknown): string {
  const record = asRecord(body);
  const say = asTrimmed(record?.say);
  if (say) return say;
  const detail = record?.detail;
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        const entry = asRecord(item);
        if (!entry) return "";
        const loc = Array.isArray(entry.loc) ? entry.loc.map(String).join(".") : "";
        const msg = asTrimmed(entry.msg);
        return [loc, msg].filter(Boolean).join(": ");
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  const encoded = JSON.stringify(body ?? {});
  return encoded && encoded !== "{}" ? `HTTP ${status} ${encoded.slice(0, 600)}` : `HTTP ${status}`;
}

/**
 * One POST per typed tool call.
 * Refreshes the Firebase token once on 401 and does not retry a second time.
 */
export async function postVoiceAction(
  args: PostVoiceActionArgs,
): Promise<{ status: number; body: VoiceActionResponse }> {
  const url = `${joinApiBase(args.apiBase)}/api/workspaces/${encodeURIComponent(args.workspaceId)}/voice/actions`;
  const primary = args.selection.primaryPaneId?.trim() ?? "";
  const revision = args.selection.contextRevision ?? 0;
  const payload: Record<string, unknown> = {
    turn_id: args.turnId,
    utterance: args.utterance,
    primary_pane_id: primary,
    focused_pane_ids: (args.selection.focusedPaneIds ?? []).map((id) => id.trim()).filter(Boolean),
    call: normalizeVoiceCall(args.call),
  };
  if (revision >= 1) payload.context_revision = revision;
  const send = async (token: string | null) => {
    console.log(`[auth] POST /api/workspaces/${args.workspaceId}/voice/actions bearer=${token ? "present" : "missing"}`);
    return fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
  };

  let token = await args.getToken();
  if (!token) token = await args.refreshToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await args.refreshToken();
    if (fresh && fresh !== token) {
      response = await send(fresh);
    }
  }

  let body: VoiceActionResponse = {};
  try {
    body = (await response.json()) as VoiceActionResponse;
  } catch {
    body = {};
  }
  if (!response.ok) {
    const detail = formatVoiceActionError(response.status, body);
    console.log(`[voice] ${args.turnId} voice/actions ${response.status}`, detail, {
      sent: payload.call,
      raw: args.call,
    });
    throw new Error(detail);
  }
  return { status: response.status, body };
}
