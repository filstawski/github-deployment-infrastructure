import { MANAGED_BY } from "../core/types.js";

export const MANAGED_TOPICS = ["deployment", "ephemeral", "managed-by-github-deployment-infrastructure"];

export interface RepoMarkerInfo {
  topics: string[];
  description?: string | null;
}

/**
 * A repository name prefix alone is never sufficient proof of ownership
 * (spec section 17). Only repositories that carry the managed-by topic are
 * eligible for destructive operations (destroy/cleanup).
 */
export function isManagedRepository(info: RepoMarkerInfo): boolean {
  return info.topics.includes(`managed-by-${MANAGED_BY}`) || info.topics.includes("managed-by-github-deployment-infrastructure");
}

export function buildManagedTopics(): string[] {
  return [...MANAGED_TOPICS];
}

export function buildRepoDescription(deploymentId: string, sourceRepository: string, sourceRef: string): string {
  return `Ephemeral preview deployment ${deploymentId} — managed by ${MANAGED_BY}. Source: ${sourceRepository}@${sourceRef}. Safe to delete after expiry.`;
}
