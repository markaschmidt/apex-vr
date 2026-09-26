import {
  AnimationClip,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  type Object3D,
} from "three";
import type { VRM } from "@pixiv/three-vrm";

const IDLE_DURATION = 4.8;
const ARM_DROP = 1.18;
const SPINE_BREATHE = Math.PI * 0.012;
const AXIS_Z = new Vector3(0, 0, 1);
const AXIS_X = new Vector3(1, 0, 0);

type Humanoid = NonNullable<VRM["humanoid"]>;
type HumanBoneName = Parameters<Humanoid["getNormalizedBoneNode"]>[0];

/**
 * Standing idle for VRM humanoids that ship without Mixamo/glTF clips
 * (OSA mascots like Milk are T-pose VRM 0.x with zero embedded animations).
 * Uses normalized bones so VRM 0 and VRM 1 share the same axes.
 */
export function createHumanoidIdleClip(vrm: VRM, duration = IDLE_DURATION): AnimationClip | null {
  const humanoid = vrm.humanoid;
  if (!humanoid) return null;

  const bones: Array<[HumanBoneName, Vector3, number, number]> = [
    // Normalized bones are rest-relative. These signs match the OSA/VRM rigs
    // used by Vektral; the smaller angle leaves a relaxed gap at the torso.
    ["leftUpperArm", AXIS_Z, ARM_DROP, ARM_DROP - 0.012],
    ["rightUpperArm", AXIS_Z, -ARM_DROP, -ARM_DROP + 0.012],
    ["spine", AXIS_X, 0, SPINE_BREATHE],
    ["chest", AXIS_X, 0, SPINE_BREATHE * 0.6],
    ["neck", AXIS_X, 0, SPINE_BREATHE * 0.35],
    ["head", AXIS_X, 0, -SPINE_BREATHE * 0.2],
  ];

  const tracks: QuaternionKeyframeTrack[] = [];
  for (const [bone, axis, angleA, angleB] of bones) {
    const node = humanoid.getNormalizedBoneNode(bone);
    if (!node) continue;
    tracks.push(loopTrack(node, axis, angleA, angleB, duration));
  }

  if (tracks.length === 0) return null;
  return new AnimationClip("idle", duration, tracks);
}

function loopTrack(
  node: Object3D,
  axis: Vector3,
  angleStart: number,
  angleMid: number,
  duration: number,
): QuaternionKeyframeTrack {
  const rest = node.quaternion.clone();
  const start = rest.clone().multiply(new Quaternion().setFromAxisAngle(axis, angleStart));
  const mid = rest.clone().multiply(new Quaternion().setFromAxisAngle(axis, angleMid));
  return new QuaternionKeyframeTrack(
    `${node.name}.quaternion`,
    [0, duration / 2, duration],
    [...start.toArray(), ...mid.toArray(), ...start.toArray()],
  );
}
