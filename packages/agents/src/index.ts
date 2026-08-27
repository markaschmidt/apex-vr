export {
  AgentController,
  type AgentControllerOptions,
} from "./AgentController.js";
export {
  ChatMessageSchema,
  ModelRequestSchema,
  ModelRouter,
  OpenRouterProvider,
  type ChatMessage,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type OpenRouterOptions,
} from "./ModelRouter.js";
export {
  DEFAULT_CLIP_ASSETS,
  GLTF_CLIP_ALIASES,
  resolveClipAsset,
  resolveGltfClipName,
} from "./avatar/clipMap.js";
export {
  createRiggedPlayback,
  playRiggedClip,
  type RiggedAvatarPlayback,
} from "./avatar/RiggedAvatar.js";
export {
  PHASE_COLORS,
  proceduralMotion,
  type ProceduralAvatarParams,
} from "./avatar/ProceduralAvatar.js";
export {
  AgentClipSchema,
  AgentIntentSchema,
  AgentPhaseSchema,
  AgentPoseSchema,
  DEFAULT_PHASE_CLIPS,
  Vec3Schema,
  type AgentClip,
  type AgentIdentity,
  type AgentIntent,
  type AgentListener,
  type AgentLocomotion,
  type AgentPhase,
  type AgentPose,
  type AgentSnapshot,
  type AgentWorkIndicator,
  type Vec3,
} from "./types.js";
