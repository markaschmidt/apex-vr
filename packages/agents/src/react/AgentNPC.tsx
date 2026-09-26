import type { VRM } from "@pixiv/three-vrm";
import { useFrame } from "@react-three/fiber";
import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { AnimationClip, Group } from "three";
import { proceduralMotion } from "../avatar/ProceduralAvatar.js";
import type { AgentController } from "../controllers/index.js";
import type { AgentClip, AgentSnapshot } from "../types.js";
import { ProceduralAgentMesh } from "./ProceduralAgentMesh.js";
import { RiggedAgentMesh } from "./RiggedAgentMesh.js";
import { VrmAgentMesh } from "./VrmAgentMesh.js";
import { WorkIndicator } from "./WorkIndicator.js";
import { novaLocoLog } from "../debug/locoLog.js";

export interface AgentNPCProps {
  controller: AgentController;
  /** Override glTF clip name resolution per logical clip. */
  clipOverrides?: Partial<Record<AgentClip, string>>;
  /** Uniform scale applied to rigged models (model units → scene units). */
  avatarScale?: number;
  /** Height of the work-indicator badge above the agent root. */
  workIndicatorHeight?: number;
  /** Host Mixamo (or other) clips retargeted onto the loaded VRM. */
  loadExternalClips?: (
    vrm: VRM,
  ) => Promise<Partial<Record<AgentClip, AnimationClip>>>;
}

function semanticRenderChanged(a: AgentSnapshot, b: AgentSnapshot): boolean {
  return (
    a.clip !== b.clip ||
    a.phase !== b.phase ||
    a.presence !== b.presence ||
    Boolean(a.locomotion) !== Boolean(b.locomotion) ||
    a.locomotionSubstate !== b.locomotionSubstate ||
    a.identity.avatarUrl !== b.identity.avatarUrl ||
    a.workIndicator?.active !== b.workIndicator?.active ||
    a.workIndicator?.label !== b.workIndicator?.label ||
    a.gestureName !== b.gestureName ||
    a.gestureGeneration !== b.gestureGeneration ||
    a.blockedReason !== b.blockedReason ||
    a.focusTargetId !== b.focusTargetId
  );
}

class RiggedAvatarBoundary extends React.Component<
  { onError: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

/**
 * Drop-in R3F agent. Loads VRM or rigged glTF when `identity.avatarUrl` is set;
 * otherwise renders the procedural capsule fallback.
 */
export function AgentNPC({
  controller,
  clipOverrides,
  avatarScale = 0.26,
  workIndicatorHeight = 1.35,
  loadExternalClips,
}: AgentNPCProps) {
  const group = useRef<Group>(null);
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(controller.state);
  const [rigFailed, setRigFailed] = useState(false);
  const onRigError = useCallback(() => setRigFailed(true), []);

  useEffect(() => {
    return controller.subscribe((next) => {
      setSnapshot((prev) => {
        if (!semanticRenderChanged(prev, next)) return prev;
        novaLocoLog("npc.snapshot", {
          clip: next.clip,
          phase: next.phase,
          presence: next.presence,
          moving: Boolean(next.locomotion),
          substate: next.locomotionSubstate,
          focus: next.focusTargetId,
          pose: next.pose.position,
        });
        return next;
      });
    });
  }, [controller]);

  const avatarUrl = snapshot.identity.avatarUrl;
  const useRigged = Boolean(avatarUrl) && !rigFailed;
  const isVrm = avatarUrl?.toLowerCase().endsWith(".vrm") ?? false;

  useFrame(({ clock }, delta) => {
    controller.tick(Math.min(delta, 1 / 20));

    if (!group.current) return;
    const state = controller.state;
    const motion = proceduralMotion({
      phase: state.phase,
      time: clock.elapsedTime,
    });
    const [x, y, z] = state.pose.position;
    group.current.position.set(x, useRigged ? y : y + motion.yOffset, z);
    group.current.rotation.y = state.pose.rotationY + (useRigged ? 0 : motion.yaw);
  });

  return (
    <group ref={group}>
      {useRigged && avatarUrl ? (
        <Suspense fallback={<ProceduralAgentMesh snapshot={snapshot} time={0} />}>
          <RiggedAvatarBoundary onError={onRigError}>
            {isVrm ? (
              <VrmAgentMesh
                url={avatarUrl}
                snapshot={snapshot}
                scale={avatarScale}
                clipOverrides={clipOverrides}
                loadExternalClips={loadExternalClips}
                onError={onRigError}
                controller={controller}
              />
            ) : (
              <RiggedAgentMesh
                url={avatarUrl}
                snapshot={snapshot}
                scale={avatarScale}
                clipOverrides={clipOverrides}
                controller={controller}
              />
            )}
          </RiggedAvatarBoundary>
        </Suspense>
      ) : (
        <ProceduralAgentMesh snapshot={snapshot} time={0} />
      )}

      <WorkIndicator
        active={Boolean(snapshot.workIndicator?.active)}
        label={snapshot.workIndicator?.label}
        height={workIndicatorHeight}
      />
    </group>
  );
}
