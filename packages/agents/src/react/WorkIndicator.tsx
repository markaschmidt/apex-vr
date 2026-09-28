import { Text } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { Quaternion, type Group } from "three";

export interface WorkIndicatorProps {
  active: boolean;
  label?: string;
  /** Height above the agent root (world units). */
  height?: number;
}

const worldQuat = new Quaternion();
const parentQuat = new Quaternion();

/**
 * Floating badge while an agent is busy.
 * Copies the camera orientation so the label stays upright and left-to-right
 * from any side, including behind the avatar.
 */
export function WorkIndicator({ active, label = "Working…", height = 1.35 }: WorkIndicatorProps) {
  const group = useRef<Group>(null);

  useFrame(({ camera, clock }) => {
    const node = group.current;
    if (!node || !active) return;
    node.position.y = height + Math.sin(clock.elapsedTime * 1.2) * 0.008;
    camera.getWorldQuaternion(worldQuat);
    const parent = node.parent;
    if (parent) {
      parent.getWorldQuaternion(parentQuat);
      node.quaternion.copy(parentQuat.invert()).multiply(worldQuat);
    } else {
      node.quaternion.copy(worldQuat);
    }
  });

  if (!active) return null;

  return (
    <group ref={group} position={[0, height, 0]}>
      <mesh position={[0, 0, -0.012]} renderOrder={1}>
        <planeGeometry args={[0.86, 0.22]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.88} depthWrite={false} />
      </mesh>
      <Text
        position={[0, 0, 0.012]}
        fontSize={0.07}
        color="#f8fafc"
        anchorX="center"
        anchorY="middle"
        renderOrder={2}
      >
        {label}
      </Text>
    </group>
  );
}
