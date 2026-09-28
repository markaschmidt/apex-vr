import assert from "node:assert/strict";
import test from "node:test";
import {
  actionResultForAgent,
  buildWorkspaceState,
  normalizeVoiceCall,
  postVoiceAction,
} from "./voiceAction.js";

test("buildWorkspaceState marks only clicked panes", () => {
  const state = buildWorkspaceState(
    [
      { id: "a", title: "Home", route: "/", kind: "preview" },
      { id: "b", title: "Notes", route: "", kind: "blank" },
      { id: "c", title: "Chat", route: "/chat", kind: "chat" },
    ],
    { primaryPaneId: "b", focusedPaneIds: ["a"] },
  );
  assert.deepEqual(
    state.panes.map((pane) => ({ id: pane.id, selected: pane.selected, primary: pane.primary, kind: pane.kind })),
    [
      { id: "a", selected: true, primary: false, kind: "preview" },
      { id: "b", selected: true, primary: true, kind: "blank" },
      { id: "c", selected: false, primary: false, kind: "chat" },
    ],
  );
});

test("actionResultForAgent keeps clarify and drops a null clarify", () => {
  assert.deepEqual(
    actionResultForAgent(
      {
        turn_id: "turn-abcdefgh",
        ok: true,
        say: "Which screen?",
        clarify: { question: "Which screen?", candidates: [{ id: "a", title: "Home" }] },
      },
      "fallback",
    ),
    {
      turn_id: "turn-abcdefgh",
      ok: true,
      say: "Which screen?",
      clarify: { question: "Which screen?", candidates: [{ id: "a", title: "Home" }] },
    },
  );
  assert.equal("clarify" in actionResultForAgent({ ok: true, say: "Done", clarify: null }, "t"), false);
});

test("normalizeVoiceCall flattens arguments and keeps one target", () => {
  assert.deepEqual(
    normalizeVoiceCall({
      name: "open_pane",
      arguments: { kind: "preview", title: " Shop ", url: "" },
      behavior: "respond",
    }),
    { tool: "open_pane", kind: "page", title: "Shop" },
  );
  assert.deepEqual(
    normalizeVoiceCall({ action: "close_pane", target: "selected", extra: true }),
    { tool: "close_pane", target: { ref: "selected" } },
  );
});

test("postVoiceAction refreshes once on 401 and sends the tool call intact", async () => {
  const calls: Array<{ url: string; token: string | null; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const token = headers.get("Authorization")?.replace(/^Bearer /, "") ?? null;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), token, body });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
    }
    return new Response(
      JSON.stringify({ turn_id: "turn-abcdefgh", ok: true, say: "Opened.", duplicate: false }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const result = await postVoiceAction({
      apiBase: "https://vektre.co/vektral",
      workspaceId: "ws_1",
      turnId: "turn-abcdefgh",
      utterance: "place a blank screen",
      call: {
        action: "run_sequence",
        turn_id: "turn-abcdefgh",
        steps: [{ action: "edit_page" }, { action: "perform", emote: "dance" }],
      },
      selection: { primaryPaneId: "pane_a", focusedPaneIds: ["pane_a"], contextRevision: 3 },
      getToken: () => "old-token",
      refreshToken: () => "new-token",
    });
    assert.equal(result.body.say, "Opened.");
    assert.equal(calls.length, 2);
    assert.equal(calls[0]!.token, "old-token");
    assert.equal(calls[1]!.token, "new-token");
    assert.match(calls[0]!.url, /\/api\/workspaces\/ws_1\/voice\/actions$/);
    assert.equal(calls[1]!.body.utterance, "place a blank screen");
    assert.deepEqual((calls[1]!.body.call as { steps: unknown }).steps, [
      { tool: "edit_page" },
      { tool: "perform", emote: "dance" },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});
