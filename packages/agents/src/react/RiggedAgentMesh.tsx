import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import type { AnimationAction, Group } from "three";
import type { AgentController } from "../controllers/index.js";
import {
  createRiggedPlayback,
  playRiggedClip,
  type RiggedAvatarPlayback,
} from "../avatar/RiggedAvatar.js";
import { inspectLoadedClips } from "../avatar/gestures.js";
import type { AgentClip, AgentSnapshot } from "../types.js";

export interface RiggedAgentMeshProps {
  url: string;
  snapshot: AgentSnapshot;
  scale?: number;
  clipOverrides?: Partial<Record<AgentClip, string>>;
  controller?: AgentController;
}

/**
 * glTF / GLB rigged avatar with AnimationMixer clip playback.
 */
export function RiggedAgentMesh({
  url,
  snapshot,
  scale = 0.26,
  clipOverrides,
  controller,
}: RiggedAgentMeshProps) {
  const group = useRef<Group>(null);
  const playbackRef = useRef<RiggedAvatarPlayback | null>(null);
  const currentAction = useRef<AnimationAction | null>(null);
  const lastClip = useRef<AgentClip | null>(null);
  const generationRef = useRef(snapshot.gestureGeneration);
  const controllerRef = useRef(controller);
  generationRef.current = snapshot.gestureGeneration;
  controllerRef.current = controller;

  const gltf = useGLTF(url);
  const model = useMemo(() => gltf.scene.clone(true), [gltf.scene]);

  useEffect(() => {
    model.scale.setScalar(scale);
    playbackRef.current = createRiggedPlayback(model, gltf.animations, clipOverrides);
    const playback = playbackRef.current;
    const idle = playback.actions.get("idle");
    if (idle) {
      idle.play();
      currentAction.current = idle;
      lastClip.current = "idle";
    }
    playback.mixer.addEventListener("finished", () => {
      if (generationRef.current == null) return;
      controllerRef.current?.notifyClipFinished(generationRef.current);
    });
    controllerRef.current?.reportLoadedPlayback({
      clips: inspectLoadedClips(playback.actions),
      lookAt: false,
    });

    return () => {
      playbackRef.current?.mixer.stopAllAction();
      playbackRef.current = null;
      currentAction.current = null;
      lastClip.current = null;
      controllerRef.current?.reportLoadedPlayback(null);
    };
  }, [model, gltf.animations, scale, clipOverrides]);

  useEffect(() => {
    const playback = playbackRef.current;
    if (!playback || lastClip.current === snapshot.clip) return;
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
  }, [snapshot.clip, snapshot.gestureName]);

  useFrame((_, delta) => {
    playbackRef.current?.mixer.update(delta);
  });

  return (
    <group ref={group}>
      <primitive object={model} />
    </group>
  );
}
