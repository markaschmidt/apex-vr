import { Text } from "@react-three/drei";
import { proceduralMotion } from "../avatar/ProceduralAvatar.js";
import type { AgentSnapshot } from "../types.js";

export interface ProceduralAgentMeshProps {
  snapshot: AgentSnapshot;
  time: number;
}

/** Default capsule avatar when no rigged model is available. */
export function ProceduralAgentMesh({ snapshot, time }: ProceduralAgentMeshProps) {
  const motion = proceduralMotion({ phase: snapshot.phase, time });

  return (
    <>
      <mesh position={[0, 0.65, 0]}>
        <sphereGeometry args={[0.23, 32, 32]} />
        <meshStandardMaterial
          color={motion.color}
          emissive={motion.color}
          emissiveIntensity={0.25}
        />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <capsuleGeometry args={[0.2, 0.35, 8, 18]} />
        <meshStandardMaterial color="#182235" roughness={0.45} />
      </mesh>
      <Text
        position={[0, 1.05, 0]}
        fontSize={0.11}
        color="#f8fafc"
        outlineWidth={0.005}
        outlineColor="#070b14"
      >
        {`${snapshot.identity.displayName} · ${snapshot.phase.toUpperCase()}`}
      </Text>
    </>
  );
}
