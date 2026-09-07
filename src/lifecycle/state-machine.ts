import type { DeploymentStatus } from "../core/types.js";

/** Valid forward transitions per spec section 6. `failed` is reachable from any non-terminal state. */
const TRANSITIONS: Record<DeploymentStatus, DeploymentStatus[]> = {
  requested: ["provisioning", "failed"],
  provisioning: ["building", "failed"],
  building: ["deploying", "failed"],
  deploying: ["verifying", "failed"],
  verifying: ["active", "failed"],
  active: ["expiring", "building", "destroying", "failed"],
  expiring: ["destroying", "failed"],
  destroying: ["destroyed", "failed"],
  destroyed: [],
  failed: ["provisioning", "building", "destroying"],
};

export function canTransition(from: DeploymentStatus, to: DeploymentStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DeploymentStatus, to: DeploymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid deployment state transition: ${from} -> ${to}`);
  }
}
