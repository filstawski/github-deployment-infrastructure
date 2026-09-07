import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Deployment } from "../src/core/types.js";

const state = {
  exists: true,
  topics: [] as string[],
  deleted: false,
};

vi.mock("../src/providers/github-pages/client.js", () => ({
  createOctokit: vi.fn(() => ({})),
  repositoryExists: vi.fn(async () => state.exists),
  getRepoTopics: vi.fn(async () => state.topics),
  deleteRepository: vi.fn(async () => {
    state.deleted = true;
  }),
}));

const { GitHubPagesProvider } = await import("../src/providers/github-pages/provider.js");
const { ProviderError } = await import("../src/core/errors.js");

function makeDeployment(): Deployment {
  return {
    id: "dep_test1",
    name: "portfolio",
    source: { repository: "owner/source", ref: "design/a" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "portfolio-a83f21" },
    lifecycle: { createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), ttl: "3d" },
    status: "active",
    urls: { repository: "https://github.com/deployments-org/portfolio-a83f21" },
    metadata: { managedBy: "github-deployment-infrastructure", version: 1 },
  };
}

beforeEach(() => {
  state.exists = true;
  state.topics = [];
  state.deleted = false;
});

describe("GitHubPagesProvider.destroy safety", () => {
  it("refuses to delete a repository missing the managed-by topic", async () => {
    state.topics = [];
    const provider = new GitHubPagesProvider({ token: "fake-token" });
    await expect(provider.destroy(makeDeployment())).rejects.toThrow(ProviderError);
    expect(state.deleted).toBe(false);
  });

  it("deletes a repository that carries the managed-by topic", async () => {
    state.topics = ["deployment", "ephemeral", "managed-by-github-deployment-infrastructure"];
    const provider = new GitHubPagesProvider({ token: "fake-token" });
    await provider.destroy(makeDeployment());
    expect(state.deleted).toBe(true);
  });

  it("is idempotent when the repository no longer exists", async () => {
    state.exists = false;
    const provider = new GitHubPagesProvider({ token: "fake-token" });
    await expect(provider.destroy(makeDeployment())).resolves.toBeUndefined();
    expect(state.deleted).toBe(false);
  });
});
