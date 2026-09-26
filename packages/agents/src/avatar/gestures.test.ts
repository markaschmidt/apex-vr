import assert from "node:assert/strict";
import { test } from "node:test";
import { AnimationClip, NumberKeyframeTrack } from "three";
import {
  clipsEquivalent,
  inspectLoadedClips,
  resolveGestureClip,
  supportedGestures,
} from "./gestures.js";
import { buildRuntimeCapabilities } from "../embodiment/capabilities.js";

function clip(name: string, duration: number, tracks = 1): AnimationClip {
  const times = [0, duration];
  const values = Array.from({ length: tracks * 2 }, () => 0);
  return new AnimationClip(name, duration, [
    new NumberKeyframeTrack(".position", times, values),
  ]);
}

test("idle clones are not dedicated LoopOnce gesture clips", () => {
  const idle = clip("idle", 2);
  const talk = idle.clone();
  talk.name = "talk";
  const wave = clip("wave", 1.1);
  const actions = new Map([
    ["idle", { getClip: () => idle }],
    ["talk", { getClip: () => talk }],
    ["wave", { getClip: () => wave }],
    ["work", { getClip: () => idle.clone() }],
  ]);
  const loaded = inspectLoadedClips(actions);
  const playback = { clips: loaded, lookAt: false };
  assert.equal(clipsEquivalent(idle, talk), true);
  assert.equal(resolveGestureClip("wave", playback)?.name, "wave");
  assert.equal(resolveGestureClip("nod", playback), null);
  assert.equal(resolveGestureClip("present", playback), null);
  assert.deepEqual(supportedGestures(playback), ["wave"]);
});

test("buildRuntimeCapabilities never reads Mixamo URL maps", () => {
  const empty = buildRuntimeCapabilities({ playback: null });
  assert.ok(empty.ids.includes("avatar.plan.v2"));
  assert.equal(empty.ids.includes("gesture.wave"), false);
  assert.equal(empty.ids.includes("gaze.speaker"), false);

  const wired = buildRuntimeCapabilities({
    playback: {
      lookAt: true,
      clips: [
        { name: "idle", duration: 2, dedicatedLoopOnce: false },
        { name: "point", duration: 0.8, dedicatedLoopOnce: true },
      ],
    },
  });
  assert.ok(wired.ids.includes("gaze.speaker"));
  assert.ok(wired.ids.includes("gesture.point"));
  assert.equal(wired.ids.includes("gesture.wave"), false);
});
