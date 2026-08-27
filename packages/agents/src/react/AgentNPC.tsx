import { useFrame } from "@react-three/fiber";
import React, { Suspense, useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { proceduralMotion } from "../avatar/ProceduralAvatar.js";
import type { AgentController } from "../AgentController.js";
import type { AgentClip, AgentSnapshot } from "../types.js";
import { ProceduralAgentMesh } from "./ProceduralAgentMesh.js";
import { RiggedAgentMesh } from "./RiggedAgentMesh.js";
import { WorkIndicator } from "./WorkIndicator.js";

export interface AgentNPCProps {
  controller: AgentController;
  /** Override glTF clip name resolution per logical clip. */
  clipOverrides?: Partial<Record<AgentClip, string>>;
  /** Uniform scale applied to rigged models (model units → scene units). */
  avatarScale?: number;
  /** Height of the work-indicator badge above the agent root. */
  workIndicatorHeight?: number;
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
 * Drop-in R3F agent. Loads a rigged glTF when `identity.avatarUrl` is set;
 * otherwise renders the procedural capsule fallback.
 */
export function AgentNPC({
  controller,
  clipOverrides,
  avatarScale = 0.26,
  workIndicatorHeight = 1.35,
}: AgentNPCProps) {
  const group = useRef<Group>(null);
  const [snapshot, setSnapshot] = useState<AgentSnapshot>(controller.state);
  const [rigFailed, setRigFailed] = useState(false);

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  const avatarUrl = snapshot.identity.avatarUrl;
  const useRigged = Boolean(avatarUrl) && !rigFailed;

  useFrame(({ clock }, delta) => {
    if (controller.state.locomotion) {
      controller.tickLocomotion(delta);
    }

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
    <group ref={group} position={snapshot.pose.position}>
      {useRigged && avatarUrl ? (
        <Suspense fallback={<ProceduralAgentMesh snapshot={snapshot} time={0} />}>
          <RiggedAvatarBoundary onError={() => setRigFailed(true)}>
            <RiggedAgentMesh
              url={avatarUrl}
              snapshot={snapshot}
              scale={avatarScale}
              clipOverrides={clipOverrides}
            />
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
