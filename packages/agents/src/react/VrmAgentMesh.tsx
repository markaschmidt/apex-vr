import { VRMLoaderPlugin, type VRM } from "@pixiv/three-vrm";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Object3D } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { AnimationAction, AnimationClip, Group } from "three";
import type { AgentController } from "../controllers/index.js";
import {
  createRiggedPlaybackFromClips,
  playRiggedClip,
  playStandingFidget,
  RIGGED_CLIP_KINDS,
  type RiggedAvatarPlayback,
} from "../avatar/RiggedAvatar.js";
import { inspectLoadedClips } from "../avatar/gestures.js";
import { novaLocoLog } from "../debug/locoLog.js";
import { createHumanoidIdleClip } from "../avatar/humanoidIdle.js";
import { resolveGltfClipName } from "../avatar/clipMap.js";
import type { AgentClip, AgentSnapshot } from "../types.js";

/** Seconds of looping Mixamo idle before idle_2 (secondary stand fidget). */
const IDLE_FIDGET_AFTER_SEC = 5.5;

export interface VrmAgentMeshProps {
  url: string;
  snapshot: AgentSnapshot;
  scale?: number;
  clipOverrides?: Partial<Record<AgentClip, string>>;
  /** Host-provided clips (Mixamo retarget). Overlay embedded glTF clips. */
  loadExternalClips?: (
    vrm: VRM,
  ) => Promise<Partial<Record<AgentClip, AnimationClip>>>;
  onError?: () => void;
  controller?: AgentController;
}

/**
 * VRM humanoid avatar. Plays embedded clips and/or host Mixamo clips.
 * Controller still drives locomotion when no clip is mapped.
 * Gaze uses `vrm.lookAt.target` toward a locally resolved pane/user point.
 */
export function VrmAgentMesh({
  url,
  snapshot,
  scale = 1,
  clipOverrides,
  loadExternalClips,
  onError,
  controller,
}: VrmAgentMeshProps) {
  const root = useRef<Group>(null);
  const vrmRef = useRef<VRM | null>(null);
  const playbackRef = useRef<RiggedAvatarPlayback | null>(null);
  const currentAction = useRef<AnimationAction | null>(null);
  const lastClip = useRef<AgentClip | null>(null);
  const clipRef = useRef<AgentClip>(snapshot.clip);
  const movingRef = useRef(Boolean(snapshot.locomotion));
  const gestureRef = useRef(snapshot.gestureName);
  const generationRef = useRef(snapshot.gestureGeneration);
  const stillSec = useRef(0);
  const fidgeting = useRef(false);
  const lookTarget = useRef(new Object3D());
  const controllerRef = useRef(controller);
  const onErrorRef = useRef(onError);
  clipRef.current = snapshot.clip;
  movingRef.current = Boolean(snapshot.locomotion);
  gestureRef.current = snapshot.gestureName;
  generationRef.current = snapshot.gestureGeneration;
  controllerRef.current = controller;
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    novaLocoLog("vrm.effect.start", { url, scale });
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    void loader
      .loadAsync(url)
      .then(async (gltf) => {
        if (!alive || !root.current) return;
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) throw new Error(`No VRM payload in ${url}`);

        vrm.scene.scale.setScalar(scale);
        vrm.scene.traverse((child: { frustumCulled: boolean }) => {
          child.frustumCulled = false;
        });
        root.current.add(vrm.scene);
        vrmRef.current = vrm;
        lookTarget.current.name = "apex-look-at";
        if (vrm.lookAt) {
          vrm.lookAt.autoUpdate = true;
          vrm.lookAt.target = lookTarget.current;
        }

        const clips: Partial<Record<AgentClip, AnimationClip>> = {};
        const names = gltf.animations.map((clip) => clip.name);
        for (const kind of RIGGED_CLIP_KINDS) {
          const gltfName = resolveGltfClipName(kind, names, clipOverrides);
          if (!gltfName) continue;
          const source = gltf.animations.find((clip) => clip.name === gltfName);
          if (source) clips[kind] = source;
        }

        if (loadExternalClips) {
          try {
            const extra = await loadExternalClips(vrm);
            if (!alive) return;
            for (const kind of RIGGED_CLIP_KINDS) {
              const clip = extra[kind];
              if (clip) clips[kind] = clip;
            }
          } catch (error) {
            console.warn("Mixamo clips failed; using embedded/procedural idle", error);
          }
        }

        if (!clips.idle) {
          const idle = createHumanoidIdleClip(vrm);
          if (idle) clips.idle = idle;
        }

        const bindClips = (next: Partial<Record<AgentClip, AnimationClip>>) => {
          playbackRef.current?.mixer.stopAllAction();
          if (Object.keys(next).length === 0) {
            playbackRef.current = null;
            currentAction.current = null;
            lastClip.current = null;
            controllerRef.current?.reportLoadedPlayback(null);
            return;
          }
          playbackRef.current = createRiggedPlaybackFromClips(vrm.scene, next);
          const desired = clipRef.current;
          currentAction.current = playRiggedClip(
            playbackRef.current,
            desired,
            null,
            { loopOnce: Boolean(gestureRef.current), fallbackIdle: true },
          );
          lastClip.current = desired;
          playbackRef.current.mixer.addEventListener("finished", () => {
            const npc = controllerRef.current;
            if (gestureRef.current) {
              npc?.notifyClipFinished(generationRef.current);
              return;
            }
            if (!fidgeting.current) return;
            fidgeting.current = false;
            stillSec.current = 0;
            const mixerPlayback = playbackRef.current;
            if (!mixerPlayback || clipRef.current !== "idle" || movingRef.current) {
              return;
            }
            currentAction.current = playRiggedClip(
              mixerPlayback,
              "idle",
              currentAction.current,
            );
            lastClip.current = "idle";
          });
          playbackRef.current.mixer.update(0);
          vrm.update(0);
          const loaded = inspectLoadedClips(playbackRef.current.actions);
          novaLocoLog("vrm.clips.bound", {
            url,
            names: loaded.map((clip) => clip.name),
            walk: loaded.some((clip) => clip.name === "walk"),
          });
          controllerRef.current?.reportLoadedPlayback({
            clips: loaded,
            lookAt: Boolean(vrm.lookAt),
          });
        };

        bindClips(clips);
      })
      .catch((error: unknown) => {
        console.error(`Could not load VRM ${url}`, error);
        if (alive) {
          controllerRef.current?.reportLoadedPlayback(null);
          onErrorRef.current?.();
        }
      });

    return () => {
      novaLocoLog("vrm.effect.dispose", { url });
      alive = false;
      playbackRef.current?.mixer.stopAllAction();
      playbackRef.current = null;
      currentAction.current = null;
      lastClip.current = null;
      controllerRef.current?.reportLoadedPlayback(null);
      if (vrmRef.current) {
        const vrm = vrmRef.current;
        if (vrm.lookAt) vrm.lookAt.target = undefined;
        root.current?.remove(vrm.scene);
        if (typeof vrm.dispose === "function") {
          vrm.dispose();
        }
        vrmRef.current = null;
      }
    };
  }, [url, scale, clipOverrides, loadExternalClips]);

  useEffect(() => {
    const playback = playbackRef.current;
    if (!playback || lastClip.current === snapshot.clip) return;
    fidgeting.current = false;
    stillSec.current = 0;
    currentAction.current = playRiggedClip(
      playback,
      snapshot.clip,
      currentAction.current,
      {
        loopOnce: Boolean(snapshot.gestureName),
        fallbackIdle: !snapshot.gestureName,
      },
    );
    lastClip.current = snapshot.clip;
    novaLocoLog("vrm.clip.play", {
      clip: snapshot.clip,
      gesture: snapshot.gestureName,
      moving: Boolean(snapshot.locomotion),
    });
  }, [snapshot.clip, snapshot.gestureName]);

  useFrame((_, delta) => {
    const frameDelta = Math.min(delta, 1 / 20);
    const playback = playbackRef.current;
    playback?.mixer.update(frameDelta);
    const vrm = vrmRef.current;
    const gaze = controllerRef.current?.getGazeWorldPoint();
    if (vrm?.lookAt) {
      if (gaze) {
        lookTarget.current.position.set(gaze[0], gaze[1], gaze[2]);
        vrm.lookAt.target = lookTarget.current;
      } else {
        vrm.lookAt.target = undefined;
      }
    }
    vrm?.update(frameDelta);

    if (!playback || movingRef.current || clipRef.current !== "idle" || gestureRef.current) {
      stillSec.current = 0;
      if (movingRef.current || clipRef.current !== "idle" || gestureRef.current) {
        fidgeting.current = false;
      }
      return;
    }
    if (fidgeting.current || !playback.actions.has("listen")) return;
    stillSec.current += frameDelta;
    if (stillSec.current < IDLE_FIDGET_AFTER_SEC) return;
    stillSec.current = 0;
    fidgeting.current = true;
    currentAction.current = playStandingFidget(playback, currentAction.current);
  });

  return <group ref={root} />;
}
