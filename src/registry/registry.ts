import type { Deployment, DeploymentStatus } from "../core/types.js";

/**
 * Storage-agnostic registry contract (spec section 19). The JSON file
 * backend below is the first implementation; future backends (GitHub
 * repository metadata, a database, S3, KV) can implement the same
 * interface without touching lifecycle/CLI code.
 */
export interface DeploymentRegistry {
  save(deployment: Deployment): Promise<void>;
  getById(id: string): Promise<Deployment | undefined>;
  getByRepository(owner: string, repository: string): Promise<Deployment | undefined>;
  listBySourceBranch(sourceRepository: string, ref: string): Promise<Deployment[]>;
  list(filter?: { status?: DeploymentStatus[] }): Promise<Deployment[]>;
  listExpired(now?: Date): Promise<Deployment[]>;
  listActive(): Promise<Deployment[]>;
  delete(id: string): Promise<void>;
}
