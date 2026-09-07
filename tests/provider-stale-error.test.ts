import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Deployment } from "../src/core/types.js";

vi.mock("../src/providers/github-pages/client.js", () => ({
  createOctokit: vi.fn(() => ({})),
  listRecentWorkflowRuns: vi.fn(async () => [{ head_sha: "new-sha-123", status: "completed", conclusion: "success" }]),
  getPagesInfo: vi.fn(async () => ({ url: "https://deployments-org.github.io/our-place-a/" })),
}));

vi.mock("../src/providers/github-pages/git-ops.js", () => ({
  fetchSourceRef: vi.fn(() => ({ dir: "/tmp/fake-source", cleanup: vi.fn() })),
  prepareDeploymentContent: vi.fn(() => ({ dir: "/tmp/fake-content", cleanup: vi.fn() })),
  pushAsInitialCommit: vi.fn(() => "new-sha-123"),
}));

vi.mock("../src/health/healthcheck.js", () => ({
  checkHealth: vi.fn(async () => ({ healthy: true, statusCode: 200, attempts: 1, url: "https://deployments-org.github.io/our-place-a/" })),
}));

vi.mock("../src/framework/detect.js", () => ({
  detectFramework: vi.fn(() => ({
    framework: "STATIC",
    buildCommand: "true",
    buildOutput: ".",
    reason: "test fixture",
    packageManager: "none",
  })),
}));

const { GitHubPagesProvider } = await import("../src/providers/github-pages/provider.js");

function makeFailedDeployment(): Deployment {
  return {
    id: "dep_test1",
    name: "our-place",
    source: { repository: "owner/source", ref: "design/a", commit: "old-sha-000" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "our-place-a" },
    lifecycle: { createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), ttl: "14d" },
    status: "failed",
    urls: { repository: "https://github.com/deployments-org/our-place-a" },
    metadata: {
      managedBy: "github-deployment-infrastructure",
      version: 1,
      lastError: "GitHub Actions workflow did not complete successfully (result: failure).",
      lastErrorStep: "workflow",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GitHubPagesProvider.update clears stale error metadata on success", () => {
  it("removes metadata.lastError/lastErrorStep once a subsequent update genuinely succeeds", async () => {
    const provider = new GitHubPagesProvider({ token: "fake-token" });
    const updated = await provider.update(makeFailedDeployment(), {});

    expect(updated.status).toBe("active");
    expect(updated.metadata.lastError).toBeUndefined();
    expect(updated.metadata.lastErrorStep).toBeUndefined();
  });
});
