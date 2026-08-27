import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";

export interface WorkIndicatorProps {
  active: boolean;
  label?: string;
  /** Height above the agent root (world units). */
  height?: number;
}

/**
 * Generic floating badge shown while an agent is busy (e.g. applying a change).
 */
export function WorkIndicator({ active, label = "Working…", height = 1.35 }: WorkIndicatorProps) {
  const group = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (!group.current || !active) return;
    group.current.position.y = height + Math.sin(clock.elapsedTime * 4) * 0.03;
  });

  if (!active) return null;

  return (
    <group ref={group} position={[0, height, 0]}>
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[0.55, 0.14]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
      <Text
        fontSize={0.07}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.003}
        outlineColor="#070b14"
      >
        {label}
      </Text>
    </group>
  );
}
