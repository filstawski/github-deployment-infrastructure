import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import yaml from "js-yaml";
import { ConfigError } from "./errors.js";
import type { ProjectConfig } from "./types.js";
import { clampTtl, parseTtlMs } from "./ttl.js";

export const DEFAULT_CONFIG_PATH = ".github/deployment.yml";

const DEFAULTS = {
  provider: "github-pages",
  ttl: "3d",
  healthcheckPath: "/",
  healthcheckTimeout: "10s",
  healthcheckRetries: 10,
  healthcheckRetryDelay: "5s",
  cleanup: {
    enabled: true,
    defaultTtl: "3d",
    maximumTtl: "14d",
    gracePeriod: "6h",
    requireManagedMarker: true,
    scheduleCron: "0 */3 * * *",
  },
  maxParallelDeployments: 4,
};

interface RawConfig {
  name?: string;
  provider?: string;
  github?: { deployment_owner?: string };
  defaults?: { ttl?: string };
  repository?: { prefix?: string };
  build?: { framework?: string; command?: string; output?: string };
  preview?: {
    healthcheck?: string;
    timeout?: string;
    retries?: number;
    retry_delay?: string;
    expected_status?: number[];
  };
  cleanup?: {
    enabled?: boolean;
    default_ttl?: string;
    maximum_ttl?: string;
    grace_period?: string;
    require_managed_marker?: boolean;
    schedule_cron?: string;
  };
  concurrency?: { max_parallel_deployments?: number };
}

/** Derives a project name from a repository slug when `name` is omitted. */
export function deriveNameFromRepository(repoPath: string): string {
  return basename(resolve(repoPath));
}

export function loadRawConfig(configPath: string): RawConfig | undefined {
  if (!existsSync(configPath)) return undefined;
  const contents = readFileSync(configPath, "utf-8");
  try {
    return (yaml.load(contents) as RawConfig) ?? {};
  } catch (err) {
    throw new ConfigError(`Failed to parse ${configPath}: ${(err as Error).message}`, {
      suggestedAction: `Check ${configPath} for valid YAML syntax.`,
    });
  }
}

export function loadConfig(projectDir = ".", configFile = DEFAULT_CONFIG_PATH): ProjectConfig {
  const configPath = join(projectDir, configFile);
  const raw = loadRawConfig(configPath) ?? {};

  const name = raw.name ?? deriveNameFromRepository(projectDir);
  const provider = raw.provider ?? DEFAULTS.provider;
  const deploymentOwner = raw.github?.deployment_owner;
  const ttl = raw.defaults?.ttl ?? DEFAULTS.ttl;
  const prefix = raw.repository?.prefix ?? name;

  const cleanup = {
    enabled: raw.cleanup?.enabled ?? DEFAULTS.cleanup.enabled,
    defaultTtl: raw.cleanup?.default_ttl ?? DEFAULTS.cleanup.defaultTtl,
    maximumTtl: raw.cleanup?.maximum_ttl ?? DEFAULTS.cleanup.maximumTtl,
    gracePeriod: raw.cleanup?.grace_period ?? DEFAULTS.cleanup.gracePeriod,
    requireManagedMarker: raw.cleanup?.require_managed_marker ?? DEFAULTS.cleanup.requireManagedMarker,
    scheduleCron: raw.cleanup?.schedule_cron ?? DEFAULTS.cleanup.scheduleCron,
  };

  const config: ProjectConfig = {
    name,
    provider,
    github: {
      deploymentOwner: deploymentOwner ?? "",
    },
    defaults: { ttl },
    repository: { prefix },
    build: {
      framework: (raw.build?.framework as ProjectConfig["build"]["framework"]) ?? "auto",
      command: raw.build?.command,
      output: raw.build?.output,
    },
    preview: {
      path: raw.preview?.healthcheck ?? DEFAULTS.healthcheckPath,
      timeoutMs: parseTtlMs(raw.preview?.timeout ?? DEFAULTS.healthcheckTimeout),
      retries: raw.preview?.retries ?? DEFAULTS.healthcheckRetries,
      retryDelayMs: parseTtlMs(raw.preview?.retry_delay ?? DEFAULTS.healthcheckRetryDelay),
      expectedStatus: raw.preview?.expected_status ?? [200],
    },
    cleanup,
    concurrency: {
      maxParallelDeployments: raw.concurrency?.max_parallel_deployments ?? DEFAULTS.maxParallelDeployments,
    },
  };

  validateConfig(config, configPath);
  return config;
}

export function validateConfig(config: ProjectConfig, sourcePath = DEFAULT_CONFIG_PATH): void {
  if (!config.github.deploymentOwner) {
    throw new ConfigError("Missing required setting: github.deployment_owner", {
      suggestedAction: `Add "github.deployment_owner" (a GitHub user or org login) to ${sourcePath}.`,
    });
  }
  if (!/^[a-zA-Z0-9-]+$/.test(config.github.deploymentOwner)) {
    throw new ConfigError(`Invalid github.deployment_owner: "${config.github.deploymentOwner}"`, {
      suggestedAction: "Use a valid GitHub username or organization login.",
    });
  }
  if (!config.repository.prefix || !/^[a-zA-Z0-9._-]+$/.test(config.repository.prefix)) {
    throw new ConfigError(`Invalid repository.prefix: "${config.repository.prefix}"`, {
      suggestedAction: "Use only letters, numbers, dots, underscores, and hyphens for repository.prefix.",
    });
  }

  const validFrameworks = ["auto", "STATIC", "VITE", "ASTRO", "NEXT_STATIC", "NUXT_STATIC", "GENERIC"];
  if (!validFrameworks.includes(config.build.framework)) {
    throw new ConfigError(`Invalid build.framework: "${config.build.framework}"`, {
      suggestedAction: `Use one of: ${validFrameworks.join(", ")}.`,
    });
  }

  // Validate all durations parse; throws ConfigError with actionable messages if not.
  parseTtlMs(config.defaults.ttl);
  parseTtlMs(config.cleanup.defaultTtl);
  parseTtlMs(config.cleanup.maximumTtl);
  parseTtlMs(config.cleanup.gracePeriod);

  const { clamped } = clampTtl(config.defaults.ttl, config.cleanup.maximumTtl);
  if (clamped) {
    // Do not silently allow this to pass unnoticed by callers; resolveTtl performs the actual clamp.
  }

  if (config.concurrency.maxParallelDeployments < 1) {
    throw new ConfigError("concurrency.max_parallel_deployments must be at least 1", {
      suggestedAction: `Set concurrency.max_parallel_deployments to a positive integer in ${sourcePath}.`,
    });
  }
}

/** Resolves the effective TTL for a deploy request, clamping to the configured maximum (spec section 18). */
export function resolveTtl(requestedTtl: string | undefined, config: ProjectConfig): { ttl: string; clamped: boolean } {
  const requested = requestedTtl ?? config.defaults.ttl;
  return clampTtl(requested, config.cleanup.maximumTtl);
}
