export type Framework =
  | "STATIC"
  | "VITE"
  | "ASTRO"
  | "NEXT_STATIC"
  | "NUXT_STATIC"
  | "GENERIC";

export type DeploymentStatus =
  | "requested"
  | "provisioning"
  | "building"
  | "deploying"
  | "verifying"
  | "active"
  | "expiring"
  | "destroying"
  | "destroyed"
  | "failed";

export interface HealthcheckConfig {
  path: string;
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  expectedStatus: number[];
}

export interface BuildConfig {
  framework: "auto" | Framework;
  command?: string;
  output?: string;
}

export interface CleanupConfig {
  enabled: boolean;
  defaultTtl: string;
  maximumTtl: string;
  gracePeriod: string;
  requireManagedMarker: boolean;
  scheduleCron: string;
}

export interface ConcurrencyConfig {
  maxParallelDeployments: number;
}

export interface ProjectConfig {
  name: string;
  provider: string;
  github: {
    deploymentOwner: string;
  };
  defaults: {
    ttl: string;
  };
  repository: {
    prefix: string;
  };
  build: BuildConfig;
  preview: HealthcheckConfig;
  cleanup: CleanupConfig;
  concurrency: ConcurrencyConfig;
}

export interface DeploymentSource {
  repository: string; // owner/repo
  ref: string;
  commit?: string;
}

export interface DeploymentTarget {
  provider: string;
  owner: string;
  repository: string;
}

export interface DeploymentLifecycle {
  createdAt: string;
  expiresAt: string;
  ttl: string;
  destroyedAt?: string;
  destroyReason?: string;
}

export interface DeploymentUrls {
  repository: string;
  preview?: string;
}

export interface DeploymentMetadata {
  managedBy: string;
  version: number;
  framework?: Framework;
  buildCommand?: string;
  buildOutput?: string;
  lastError?: string;
  lastErrorStep?: string;
}

export interface Deployment {
  id: string;
  name: string;
  source: DeploymentSource;
  target: DeploymentTarget;
  lifecycle: DeploymentLifecycle;
  status: DeploymentStatus;
  urls: DeploymentUrls;
  metadata: DeploymentMetadata;
}

export interface HealthResult {
  healthy: boolean;
  statusCode?: number;
  attempts: number;
  error?: string;
  url: string;
}

export interface DeploymentStatusResult {
  deployment: Deployment;
  live: {
    workflowStatus?: string;
    workflowConclusion?: string;
    pagesUrl?: string;
    health?: HealthResult;
  };
}

export interface DeploymentLogs {
  summary: string;
  runUrl?: string;
  full?: string;
}

export interface CreateRequest {
  name: string;
  sourceRepository: string; // owner/repo
  ref: string;
  commit?: string;
  owner: string;
  repositoryName: string;
  ttl: string;
  build: BuildConfig;
  healthcheck: HealthcheckConfig;
  managedBy: string;
}

export interface UpdateRequest {
  ref?: string;
  commit?: string;
}

/**
 * Provider-agnostic contract. GitHub-specific logic must stay behind
 * implementations of this interface (see src/providers/github-pages).
 */
export interface DeploymentProvider {
  readonly name: string;
  create(request: CreateRequest): Promise<Deployment>;
  deploy(deployment: Deployment, request: CreateRequest | UpdateRequest): Promise<void>;
  update(deployment: Deployment, request: UpdateRequest): Promise<Deployment>;
  destroy(deployment: Deployment): Promise<void>;
  status(deployment: Deployment): Promise<DeploymentStatusResult>;
  logs(deployment: Deployment, full: boolean): Promise<DeploymentLogs>;
  healthcheck(deployment: Deployment, config: HealthcheckConfig): Promise<HealthResult>;
  getUrl(deployment: Deployment): Promise<string>;
  /**
   * Optional: discovers all deployments this provider currently manages for
   * an owner, independent of any local registry state. Enables cleanup to
   * work correctly from a fresh checkout / CI runner that has never seen
   * the local JSON registry (spec section 16: "cleanup must work
   * independently of Claude [or a developer machine]").
   */
  listManaged?(owner: string): Promise<Deployment[]>;
}

export const MANAGED_BY = "github-deployment-infrastructure";
