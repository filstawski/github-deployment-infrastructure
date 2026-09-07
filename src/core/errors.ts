export enum ExitCode {
  OK = 0,
  GENERIC_ERROR = 1,
  CONFIG_ERROR = 2,
  AUTH_ERROR = 3,
  PROVIDER_ERROR = 4,
  BUILD_FAILURE = 5,
  HEALTHCHECK_FAILURE = 6,
  CLEANUP_FAILURE = 7,
}

export interface ActionableErrorDetails {
  project?: string;
  branch?: string;
  deploymentId?: string;
  step?: string;
  command?: string;
  suggestedAction?: string;
}

export class GdiError extends Error {
  readonly exitCode: ExitCode;
  readonly details: ActionableErrorDetails;

  constructor(message: string, exitCode: ExitCode, details: ActionableErrorDetails = {}) {
    super(message);
    this.name = "GdiError";
    this.exitCode = exitCode;
    this.details = details;
  }

  /** Renders the actionable, human-readable error format required by the spec. */
  format(): string {
    const lines: string[] = [`${this.message}`, ""];
    if (this.details.project) lines.push(`Project: ${this.details.project}`);
    if (this.details.branch) lines.push(`Branch: ${this.details.branch}`);
    if (this.details.deploymentId) lines.push(`Deployment: ${this.details.deploymentId}`);
    if (this.details.step) lines.push("", `Step: ${this.details.step}`);
    if (this.details.command) lines.push("", "Command:", this.details.command);
    lines.push("", "Error:", this.cause instanceof Error ? this.cause.message : this.message);
    if (this.details.suggestedAction) {
      lines.push("", "Suggested action:", this.details.suggestedAction);
    }
    return lines.join("\n");
  }
}

export class ConfigError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.CONFIG_ERROR, details);
    this.name = "ConfigError";
  }
}

export class AuthError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.AUTH_ERROR, details);
    this.name = "AuthError";
  }
}

export class ProviderError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.PROVIDER_ERROR, details);
    this.name = "ProviderError";
  }
}

export class BuildError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.BUILD_FAILURE, details);
    this.name = "BuildError";
  }
}

export class HealthcheckError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.HEALTHCHECK_FAILURE, details);
    this.name = "HealthcheckError";
  }
}

/**
 * Thrown by a provider's create()/update() when a deployment fails partway
 * through. Carries the partially-built deployment record (status "failed")
 * so callers can still persist it — a failed deployment must retain enough
 * metadata to diagnose the problem (spec section 6), not vanish silently.
 */
export class DeployFailedError extends GdiError {
  constructor(
    public readonly deployment: unknown,
    cause: unknown,
    exitCode: ExitCode,
    details: ActionableErrorDetails = {}
  ) {
    super(cause instanceof Error ? cause.message : String(cause), exitCode, details);
    this.name = "DeployFailedError";
    this.cause = cause instanceof Error ? cause : undefined;
  }
}

export class CleanupError extends GdiError {
  constructor(message: string, details: ActionableErrorDetails = {}) {
    super(message, ExitCode.CLEANUP_FAILURE, details);
    this.name = "CleanupError";
  }
}

/** Strips tokens/secrets from arbitrary text before it is logged or printed. */
export function redactSecrets(text: string): string {
  return text
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "***REDACTED***")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "***REDACTED***")
    .replace(/(authorization:\s*)(bearer|token)\s+\S+/gi, "$1$2 ***REDACTED***");
}
