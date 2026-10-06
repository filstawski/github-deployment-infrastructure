import { join } from "node:path";
import type { ProjectConfig, Deployment, DeploymentProvider } from "./types.js";
import type { DeploymentRegistry } from "../registry/registry.js";
import { JsonFileRegistry } from "../registry/json-file-registry.js";
import { GitHubPagesProvider } from "../providers/github-pages/provider.js";
import { resolveGitHubToken } from "../providers/github-pages/auth.js";
import { createOctokit, validateCredentials } from "../providers/github-pages/client.js";
import { buildRepositoryName } from "./naming.js";
import { resolveTtl } from "./config.js";
import { ConfigError, DeployFailedError, ProviderError } from "./errors.js";
import { settleWithConcurrency } from "./concurrency.js";
import { MANAGED_BY } from "./types.js";
import { getCurrentSourceRepository } from "./git-context.js";
import { computeExpiry, parseTtlMs } from "./ttl.js";

export const DEFAULT_REGISTRY_PATH = join(".gdi", "registry.json");

export interface OrchestratorContext {
  config: ProjectConfig;
  registry: DeploymentRegistry;
  provider: DeploymentProvider;
  sourceRepository: string;
}

export function buildProvider(config: ProjectConfig): DeploymentProvider {
  if (config.provider !== "github-pages") {
    throw new ConfigError(`Unsupported provider: "${config.provider}"`, {
      suggestedAction: "Only \"github-pages\" is implemented. See docs for adding a new provider.",
    });
  }
  const token = resolveGitHubToken();
  return new GitHubPagesProvider({ token });
}

export function createContext(config: ProjectConfig, projectDir = "."): OrchestratorContext {
  return {
    config,
    registry: new JsonFileRegistry(join(projectDir, DEFAULT_REGISTRY_PATH)),
    provider: buildProvider(config),
    sourceRepository: getCurrentSourceRepository(projectDir),
  };
}

export async function validateAccess(config: ProjectConfig): Promise<void> {
  const token = resolveGitHubToken();
  const octokit = createOctokit(token);
  await validateCredentials(octokit, config.github.deploymentOwner);
}

export interface DeployOptions {
  ttl?: string;
  forceNew?: boolean;
  dryRun?: boolean;
}

export interface DeployPlan {
  branch: string;
  repositoryName: string;
  owner: string;
  ttl: string;
  ttlClamped: boolean;
  framework: string;
  buildCommand?: string;
  buildOutput?: string;
}

export function planDeploy(ctx: OrchestratorContext, branch: string, options: DeployOptions): DeployPlan {
  const { ttl, clamped } = resolveTtl(options.ttl, ctx.config);
  const repositoryName = buildRepositoryName(ctx.config.repository.prefix, branch);
  return {
    branch,
    repositoryName,
    owner: ctx.config.github.deploymentOwner,
    ttl,
    ttlClamped: clamped,
    framework: ctx.config.build.framework,
    buildCommand: ctx.config.build.command,
    buildOutput: ctx.config.build.output,
  };
}

/** Implements idempotency (spec section 23): reuses an active deployment for the same branch unless forced. */
export async function findExistingActiveDeployment(
  ctx: OrchestratorContext,
  branch: string
): Promise<Deployment | undefined> {
  const matches = await ctx.registry.listBySourceBranch(ctx.sourceRepository, branch);
  return matches.find((d) => d.status === "active" || d.status === "verifying" || d.status === "building" || d.status === "deploying");
}

export async function deployBranch(ctx: OrchestratorContext, branch: string, options: DeployOptions): Promise<Deployment> {
  if (!options.forceNew) {
    const existing = await findExistingActiveDeployment(ctx, branch);
    if (existing) return existing;
  }

  const { ttl } = resolveTtl(options.ttl, ctx.config);
  const repositoryName = buildRepositoryName(ctx.config.repository.prefix, branch);

  try {
    const deployment = await ctx.provider.create({
      name: ctx.config.name,
      sourceRepository: ctx.sourceRepository,
      ref: branch,
      owner: ctx.config.github.deploymentOwner,
      repositoryName,
      ttl,
      build: ctx.config.build,
      healthcheck: ctx.config.preview,
      managedBy: MANAGED_BY,
    });
    await ctx.registry.save(deployment);
    return deployment;
  } catch (err) {
    // A failed deployment must retain enough metadata to diagnose the
    // problem (spec section 6) rather than vanishing from the registry.
    if (err instanceof DeployFailedError) {
      await ctx.registry.save(err.deployment as Deployment);
    }
    throw err;
  }
}

export interface PreviewResult {
  branch: string;
  deployment?: Deployment;
  error?: Error;
}

export async function previewBranches(
  ctx: OrchestratorContext,
  branches: string[],
  options: DeployOptions
): Promise<PreviewResult[]> {
  const settled = await settleWithConcurrency(branches, ctx.config.concurrency.maxParallelDeployments, (branch) =>
    deployBranch(ctx, branch, options)
  );
  return settled.map(({ item, result, error }) => ({ branch: item, deployment: result, error }));
}

export async function updateDeployment(ctx: OrchestratorContext, deploymentId: string, ref?: string): Promise<Deployment> {
  const deployment = await ctx.registry.getById(deploymentId);
  if (!deployment) {
    throw new ProviderError(`No deployment found with ID: ${deploymentId}`, {
      suggestedAction: "Run `gdi list` to see known deployment IDs.",
    });
  }
  const updated = await ctx.provider.update(deployment, { ref });
  await ctx.registry.save(updated);
  return updated;
}

export interface ExtendResult {
  deployment: Deployment;
  previousExpiresAt: string;
  ttl: string;
  ttlClamped: boolean;
  /** False when the deployment already outlives the requested window; nothing was changed. */
  extended: boolean;
}

/**
 * Pushes a deployment's expiry out to `now + ttl`. The TTL is clamped to
 * cleanup.maximum_ttl exactly like a fresh deploy, so each extension is a
 * bounded, explicit renewal — never open-ended hosting (spec section 18).
 * Never shortens an expiry; use `destroy` to end a deployment early.
 */
export async function extendDeployment(
  ctx: OrchestratorContext,
  deploymentId: string,
  requestedTtl?: string,
  now: Date = new Date()
): Promise<ExtendResult> {
  const deployment = await ctx.registry.getById(deploymentId);
  if (!deployment) {
    throw new ProviderError(`No deployment found with ID: ${deploymentId}`, {
      suggestedAction: "Run `gdi list` to see known deployment IDs.",
    });
  }
  if (deployment.status === "destroyed" || deployment.status === "destroying") {
    throw new ProviderError(`Deployment ${deploymentId} has been destroyed and cannot be extended.`, {
      deploymentId,
      suggestedAction: `Create a new one with \`gdi deploy --branch ${deployment.source.ref}\`.`,
    });
  }

  // Default to the deployment's own original TTL; registry entries
  // reconstructed from the provider carry "unknown" there.
  const fallbackTtl = isValidTtl(deployment.lifecycle.ttl) ? deployment.lifecycle.ttl : undefined;
  const { ttl, clamped } = resolveTtl(requestedTtl ?? fallbackTtl, ctx.config);
  const previousExpiresAt = deployment.lifecycle.expiresAt;
  const expiresAt = computeExpiry(now, ttl);

  if (expiresAt.getTime() <= new Date(previousExpiresAt).getTime()) {
    return { deployment, previousExpiresAt, ttl, ttlClamped: clamped, extended: false };
  }

  if (!ctx.provider.extend) {
    throw new ProviderError(`Provider "${ctx.provider.name}" does not support extending deployments.`, { deploymentId });
  }
  await ctx.provider.extend(deployment, expiresAt.toISOString());

  deployment.lifecycle.expiresAt = expiresAt.toISOString();
  deployment.lifecycle.extendedAt = now.toISOString();
  await ctx.registry.save(deployment);
  return { deployment, previousExpiresAt, ttl, ttlClamped: clamped, extended: true };
}

function isValidTtl(ttl: string): boolean {
  try {
    parseTtlMs(ttl);
    return true;
  } catch {
    return false;
  }
}

export async function destroyDeployment(ctx: OrchestratorContext, deploymentId: string, reason = "requested by user"): Promise<Deployment> {
  const deployment = await ctx.registry.getById(deploymentId);
  if (!deployment) {
    throw new ProviderError(`No deployment found with ID: ${deploymentId}`, {
      suggestedAction: "Run `gdi list` to see known deployment IDs.",
    });
  }
  deployment.status = "destroying";
  await ctx.registry.save(deployment);
  await ctx.provider.destroy(deployment);
  deployment.status = "destroyed";
  deployment.lifecycle.destroyedAt = new Date().toISOString();
  deployment.lifecycle.destroyReason = reason;
  await ctx.registry.save(deployment);
  return deployment;
}

export interface CleanupResult {
  destroyed: Deployment[];
  failed: Array<{ deployment: Deployment; error: Error }>;
}

/**
 * Merges registry-known expired deployments with deployments discovered
 * directly from the provider (spec section 16: cleanup must work
 * independently of Claude or a developer machine, e.g. from a scheduled
 * Action on a fresh checkout that has never seen the local registry file).
 */
async function discoverExpired(ctx: OrchestratorContext, now: Date): Promise<Deployment[]> {
  const fromRegistry = await ctx.registry.listExpired(now);
  const byId = new Map(fromRegistry.map((d) => [d.id, d]));

  if (ctx.provider.listManaged) {
    const managed = await ctx.provider.listManaged(ctx.config.github.deploymentOwner);
    for (const d of managed) {
      if (byId.has(d.id)) continue;
      if (new Date(d.lifecycle.expiresAt).getTime() <= now.getTime()) {
        byId.set(d.id, d);
      }
    }
  }

  return [...byId.values()];
}

/** Core requirement (spec section 16): discovers and destroys expired managed deployments. Idempotent. */
export async function runCleanup(ctx: OrchestratorContext, now: Date = new Date()): Promise<CleanupResult> {
  if (!ctx.config.cleanup.enabled) {
    return { destroyed: [], failed: [] };
  }

  const expired = await discoverExpired(ctx, now);
  const destroyed: Deployment[] = [];
  const failed: Array<{ deployment: Deployment; error: Error }> = [];

  const settled = await settleWithConcurrency(expired, ctx.config.concurrency.maxParallelDeployments, async (deployment) => {
    // Ensure destroyDeployment (which resolves by ID from the registry) can
    // find deployments that were only discovered via the provider.
    const known = await ctx.registry.getById(deployment.id);
    if (!known) await ctx.registry.save(deployment);
    return destroyDeployment(ctx, deployment.id, "ttl expired");
  });

  for (const { item, result, error } of settled) {
    if (result) destroyed.push(result);
    else if (error) failed.push({ deployment: item, error });
  }

  return { destroyed, failed };
}
