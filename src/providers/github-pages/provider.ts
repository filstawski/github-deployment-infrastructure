import type { Octokit } from "@octokit/rest";
import {
  createOctokit,
  createRepository,
  deleteRepository,
  enablePagesWorkflowBuild,
  getPagesInfo,
  getRepoTopics,
  getWorkflowRunLogsEndpoint,
  listAllRepositoriesForOwner,
  listRecentWorkflowRuns,
  ownerIsOrg,
  readJsonFile,
  repositoryExists,
  setTopics,
} from "./client.js";
import { fetchSourceRef, prepareDeploymentContent, pushAsInitialCommit } from "./git-ops.js";
import { generatePagesWorkflow } from "./workflow-templates.js";
import { buildManagedTopics, buildRepoDescription, isManagedRepository } from "../../security/managed.js";
import { checkHealth } from "../../health/healthcheck.js";
import { detectFramework } from "../../framework/detect.js";
import { detectPackageManager, runScript } from "../../framework/package-manager.js";
import { generateDeploymentId } from "../../core/id.js";
import { computeExpiry } from "../../core/ttl.js";
import { BuildError, DeployFailedError, ExitCode, GdiError, ProviderError } from "../../core/errors.js";
import { MANAGED_BY } from "../../core/types.js";
import type {
  CreateRequest,
  Deployment,
  DeploymentLogs,
  DeploymentProvider,
  DeploymentStatusResult,
  HealthResult,
  HealthcheckConfig,
  UpdateRequest,
} from "../../core/types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function computePagesUrl(owner: string, repo: string): string {
  const ownerLower = owner.toLowerCase();
  if (repo.toLowerCase() === `${ownerLower}.github.io`) {
    return `https://${ownerLower}.github.io/`;
  }
  return `https://${ownerLower}.github.io/${repo}/`;
}

export interface GitHubPagesProviderOptions {
  token: string;
  workflowWaitTimeoutMs?: number;
  workflowPollIntervalMs?: number;
}

/** GitHub-specific logic is isolated entirely within this class (spec section 10 / principle 8). */
export class GitHubPagesProvider implements DeploymentProvider {
  readonly name = "github-pages";
  private readonly octokit: Octokit;
  private readonly workflowWaitTimeoutMs: number;
  private readonly workflowPollIntervalMs: number;
  private readonly token: string;

  constructor(options: GitHubPagesProviderOptions) {
    this.token = options.token;
    this.octokit = createOctokit(options.token);
    this.workflowWaitTimeoutMs = options.workflowWaitTimeoutMs ?? 10 * 60 * 1000;
    this.workflowPollIntervalMs = options.workflowPollIntervalMs ?? 10 * 1000;
  }

  async create(request: CreateRequest): Promise<Deployment> {
    const id = generateDeploymentId();
    const createdAt = new Date();
    const expiresAt = computeExpiry(createdAt, request.ttl);

    const isOrg = await ownerIsOrg(this.octokit, request.owner);
    const description = buildRepoDescription(id, request.sourceRepository, request.ref);
    const { htmlUrl } = await createRepository(this.octokit, request.owner, request.repositoryName, description, isOrg);
    await setTopics(this.octokit, request.owner, request.repositoryName, buildManagedTopics());
    await enablePagesWorkflowBuild(this.octokit, request.owner, request.repositoryName);

    let deployment: Deployment = {
      id,
      name: request.name,
      source: { repository: request.sourceRepository, ref: request.ref, commit: request.commit },
      target: { provider: this.name, owner: request.owner, repository: request.repositoryName },
      lifecycle: { createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), ttl: request.ttl },
      status: "provisioning",
      urls: { repository: htmlUrl },
      metadata: { managedBy: MANAGED_BY, version: 1 },
    };

    try {
      deployment = await this.pushAndVerify(deployment, request);
    } catch (err) {
      deployment.status = "failed";
      deployment.metadata.lastError = err instanceof Error ? err.message : String(err);
      const exitCode = err instanceof GdiError ? err.exitCode : ExitCode.PROVIDER_ERROR;
      const details = err instanceof GdiError ? err.details : { deploymentId: deployment.id };
      throw new DeployFailedError(deployment, err, exitCode, details);
    }

    return deployment;
  }

  private async pushAndVerify(
    deployment: Deployment,
    request: CreateRequest | (UpdateRequest & { build?: CreateRequest["build"]; healthcheck?: HealthcheckConfig })
  ): Promise<Deployment> {
    const ref = ("ref" in request && request.ref) || deployment.source.ref;
    const build = "build" in request && request.build ? request.build : { framework: "auto" as const };
    const healthcheck = "healthcheck" in request && request.healthcheck ? request.healthcheck : DEFAULT_HEALTHCHECK;

    deployment.status = "building";
    const source = fetchSourceRef(deployment.source.repository, ref, this.token);
    try {
      const packageManager = detectPackageManager(source.dir);
      const detection =
        build.framework && build.framework !== "auto"
          ? { framework: build.framework, buildCommand: build.command ?? runScript(packageManager, "build"), buildOutput: build.output ?? "dist", reason: "explicit config" }
          : (() => {
              try {
                return detectFramework(source.dir);
              } catch (err) {
                throw new BuildError((err as Error).message, {
                  deploymentId: deployment.id,
                  step: "framework-detection",
                  suggestedAction: "Set build.framework, build.command, and build.output explicitly in .github/deployment.yml.",
                });
              }
            })();

      const buildCommand = build.command ?? detection.buildCommand;
      const buildOutput = build.output ?? detection.buildOutput;

      deployment.metadata.framework = detection.framework;
      deployment.metadata.buildCommand = buildCommand;
      deployment.metadata.buildOutput = buildOutput;

      const workflowYaml = generatePagesWorkflow({
        build: { command: buildCommand, output: buildOutput },
        framework: detection.framework,
        repositoryName: deployment.target.repository,
        packageManager,
      });

      const content = prepareDeploymentContent(source.dir, workflowYaml, {
        managed_by: MANAGED_BY,
        deployment_id: deployment.id,
        source_repository: deployment.source.repository,
        source_ref: ref,
        created_at: deployment.lifecycle.createdAt,
        expires_at: deployment.lifecycle.expiresAt,
      });

      try {
        deployment.status = "deploying";
        const commit = pushAsInitialCommit(
          content.dir,
          `${deployment.target.owner}/${deployment.target.repository}`,
          this.token,
          `Deploy ${deployment.source.repository}@${ref} (${deployment.id})`
        );
        deployment.source.ref = ref;
        deployment.source.commit = commit;
      } finally {
        content.cleanup();
      }
    } finally {
      source.cleanup();
    }

    deployment.status = "verifying";
    const workflowResult = await this.waitForWorkflow(
      deployment.target.owner,
      deployment.target.repository,
      deployment.source.commit
    );
    if (workflowResult !== "success") {
      throw new ProviderError(`GitHub Actions workflow did not complete successfully (result: ${workflowResult}).`, {
        deploymentId: deployment.id,
        step: "workflow",
        suggestedAction: `Run \`gdi logs ${deployment.id}\` to inspect the failure.`,
      });
    }

    const pagesInfo = await getPagesInfo(this.octokit, deployment.target.owner, deployment.target.repository);
    const previewUrl = pagesInfo?.url ?? computePagesUrl(deployment.target.owner, deployment.target.repository);
    deployment.urls.preview = previewUrl;

    const health = await checkHealth(previewUrl, healthcheck);
    if (!health.healthy) {
      throw new ProviderError(`Healthcheck failed for ${previewUrl}: ${health.error ?? "no successful response"}`, {
        deploymentId: deployment.id,
        step: "healthcheck",
        suggestedAction: "Verify the site builds correctly and the healthcheck path in .github/deployment.yml is correct.",
      });
    }

    deployment.status = "active";
    // A prior create()/update() attempt on this same deployment record may
    // have failed and left metadata.lastError set (create()'s catch block
    // persists it deliberately, so a failed deployment doesn't vanish
    // silently). Once we reach here the deployment is genuinely healthy —
    // leaving that stale message in place would misrepresent an active,
    // working deployment as having an outstanding error.
    delete deployment.metadata.lastError;
    delete deployment.metadata.lastErrorStep;
    return deployment;
  }

  /**
   * Waits for the workflow run triggered by `expectedCommit` specifically —
   * never just "the most recent run" — since a prior (stale) run for an
   * earlier push can still be the newest entry in the list for a few
   * seconds after a new push, which would otherwise report the wrong
   * result entirely.
   */
  private async waitForWorkflow(
    owner: string,
    repo: string,
    expectedCommit: string | undefined
  ): Promise<"success" | "failure" | "timeout"> {
    const deadline = Date.now() + this.workflowWaitTimeoutMs;
    while (Date.now() < deadline) {
      const runs = await listRecentWorkflowRuns(this.octokit, owner, repo, 10);
      const run = expectedCommit ? runs.find((r) => r.head_sha === expectedCommit) : runs[0];
      if (run && run.status === "completed") {
        return run.conclusion === "success" ? "success" : "failure";
      }
      await sleep(this.workflowPollIntervalMs);
    }
    return "timeout";
  }

  async deploy(deployment: Deployment, request: CreateRequest | UpdateRequest): Promise<void> {
    await this.pushAndVerify(deployment, request as any);
  }

  async update(deployment: Deployment, request: UpdateRequest): Promise<Deployment> {
    const updated = await this.pushAndVerify({ ...deployment }, {
      ref: request.ref ?? deployment.source.ref,
      commit: request.commit,
      build: { framework: "auto" },
    } as any);
    updated.metadata.version += 1;
    return updated;
  }

  async destroy(deployment: Deployment): Promise<void> {
    const exists = await repositoryExists(this.octokit, deployment.target.owner, deployment.target.repository);
    if (!exists) return; // idempotent (spec section 16)

    const topics = await getRepoTopics(this.octokit, deployment.target.owner, deployment.target.repository);
    if (!isManagedRepository({ topics })) {
      throw new ProviderError(
        `Refusing to delete ${deployment.target.owner}/${deployment.target.repository}: it is missing the managed-by topic marker.`,
        {
          deploymentId: deployment.id,
          suggestedAction: "This repository does not look like it is managed by github-deployment-infrastructure. Delete it manually if you are certain, or use --force.",
        }
      );
    }

    await deleteRepository(this.octokit, deployment.target.owner, deployment.target.repository);
  }

  async status(deployment: Deployment): Promise<DeploymentStatusResult> {
    const exists = await repositoryExists(this.octokit, deployment.target.owner, deployment.target.repository);
    if (!exists) {
      return { deployment: { ...deployment, status: "destroyed" }, live: {} };
    }

    const runs = await listRecentWorkflowRuns(this.octokit, deployment.target.owner, deployment.target.repository, 1);
    const run = runs[0];
    const pagesInfo = await getPagesInfo(this.octokit, deployment.target.owner, deployment.target.repository);

    let health: HealthResult | undefined;
    if (deployment.urls.preview) {
      health = await checkHealth(deployment.urls.preview, { ...DEFAULT_HEALTHCHECK, retries: 1 }).catch(() => undefined);
    }

    return {
      deployment,
      live: {
        workflowStatus: run?.status ?? undefined,
        workflowConclusion: run?.conclusion ?? undefined,
        pagesUrl: pagesInfo?.url,
        health,
      },
    };
  }

  async logs(deployment: Deployment, full: boolean): Promise<DeploymentLogs> {
    const runs = await listRecentWorkflowRuns(this.octokit, deployment.target.owner, deployment.target.repository, 1);
    const run = runs[0];
    if (!run) {
      return { summary: "No workflow runs found for this deployment yet." };
    }

    const summary = `Run #${run.run_number}: ${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}\n${run.html_url}`;

    if (!full) {
      return { summary, runUrl: run.html_url };
    }

    const logUrl = getWorkflowRunLogsEndpoint(deployment.target.owner, deployment.target.repository, run.id);
    return { summary, runUrl: run.html_url, full: `Download full logs (authenticated request required): ${logUrl}` };
  }

  async healthcheck(deployment: Deployment, config: HealthcheckConfig): Promise<HealthResult> {
    const url = deployment.urls.preview ?? (await this.getUrl(deployment));
    return checkHealth(url, config);
  }

  async getUrl(deployment: Deployment): Promise<string> {
    const pagesInfo = await getPagesInfo(this.octokit, deployment.target.owner, deployment.target.repository);
    return pagesInfo?.url ?? computePagesUrl(deployment.target.owner, deployment.target.repository);
  }

  async listManaged(owner: string): Promise<Deployment[]> {
    const isOrg = await ownerIsOrg(this.octokit, owner);
    const repos = await listAllRepositoriesForOwner(this.octokit, owner, isOrg);
    const managedRepos = repos.filter((r) => isManagedRepository({ topics: r.topics ?? [] }));

    const deployments: Deployment[] = [];
    for (const repo of managedRepos) {
      const metadata = await readJsonFile<{
        deployment_id?: string;
        source_repository?: string;
        source_ref?: string;
        created_at?: string;
        expires_at?: string;
      }>(this.octokit, owner, repo.name, ".gdi-deployment.json");

      if (!metadata?.deployment_id || !metadata.expires_at) continue;

      deployments.push({
        id: metadata.deployment_id,
        name: repo.name,
        source: { repository: metadata.source_repository ?? "unknown/unknown", ref: metadata.source_ref ?? "unknown" },
        target: { provider: this.name, owner, repository: repo.name },
        lifecycle: {
          createdAt: metadata.created_at ?? new Date(0).toISOString(),
          expiresAt: metadata.expires_at,
          ttl: "unknown",
        },
        status: "active",
        urls: { repository: `https://github.com/${owner}/${repo.name}`, preview: computePagesUrl(owner, repo.name) },
        metadata: { managedBy: MANAGED_BY, version: 1 },
      });
    }
    return deployments;
  }
}

const DEFAULT_HEALTHCHECK: HealthcheckConfig = {
  path: "/",
  timeoutMs: 10_000,
  retries: 10,
  retryDelayMs: 5_000,
  expectedStatus: [200],
};
