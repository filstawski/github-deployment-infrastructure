import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileRegistry } from "../src/registry/json-file-registry.js";
import { extendDeployment, runCleanup } from "../src/core/orchestrator.js";
import type { Deployment, DeploymentProvider, ProjectConfig } from "../src/core/types.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-10-06T12:00:00.000Z");

let dir: string;
let registry: JsonFileRegistry;

function makeDeployment(overrides: Partial<Deployment>): Deployment {
  return {
    id: overrides.id ?? "dep_x",
    name: "portfolio",
    source: { repository: "owner/source", ref: "design/a" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "portfolio-x" },
    lifecycle: { createdAt: NOW.toISOString(), expiresAt: new Date(NOW.getTime() + DAY).toISOString(), ttl: "3d" },
    status: "active",
    urls: { repository: "https://github.com/deployments-org/portfolio-x" },
    metadata: { managedBy: "github-deployment-infrastructure", version: 1 },
    ...overrides,
  };
}

/** Records extend() calls the way the GitHub provider would persist them remotely. */
class FakeProvider implements DeploymentProvider {
  readonly name = "fake";
  extended: Array<{ id: string; expiresAt: string }> = [];
  remote: Deployment[] = [];

  async create(): Promise<Deployment> {
    throw new Error("not used in this test");
  }
  async deploy(): Promise<void> {}
  async update(deployment: Deployment): Promise<Deployment> {
    return deployment;
  }
  async destroy(): Promise<void> {}
  async status(deployment: Deployment) {
    return { deployment, live: {} };
  }
  async logs() {
    return { summary: "" };
  }
  async healthcheck(): Promise<any> {
    return { healthy: true, attempts: 1, url: "https://example.com" };
  }
  async getUrl(): Promise<string> {
    return "https://example.com";
  }
  async extend(deployment: Deployment, expiresAt: string): Promise<void> {
    this.extended.push({ id: deployment.id, expiresAt });
    for (const d of this.remote) if (d.id === deployment.id) d.lifecycle.expiresAt = expiresAt;
  }
  async listManaged(): Promise<Deployment[]> {
    return this.remote;
  }
}

function makeConfig(): ProjectConfig {
  return {
    name: "portfolio",
    provider: "github-pages",
    github: { deploymentOwner: "deployments-org" },
    defaults: { ttl: "3d" },
    repository: { prefix: "portfolio" },
    build: { framework: "auto" },
    preview: { path: "/", timeoutMs: 1000, retries: 1, retryDelayMs: 1, expectedStatus: [200] },
    cleanup: { enabled: true, defaultTtl: "3d", maximumTtl: "14d", gracePeriod: "6h", requireManagedMarker: true, scheduleCron: "0 */3 * * *" },
    concurrency: { maxParallelDeployments: 4 },
  };
}

function ctx(provider: DeploymentProvider) {
  return { config: makeConfig(), registry, provider, sourceRepository: "owner/source" };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gdi-extend-"));
  registry = new JsonFileRegistry(join(dir, "registry.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("extendDeployment", () => {
  it("sets expiry to now + requested TTL in both the provider and the registry", async () => {
    await registry.save(makeDeployment({ id: "dep_a" }));
    const provider = new FakeProvider();

    const result = await extendDeployment(ctx(provider), "dep_a", "7d", NOW);

    const expected = new Date(NOW.getTime() + 7 * DAY).toISOString();
    expect(result.extended).toBe(true);
    expect(provider.extended).toEqual([{ id: "dep_a", expiresAt: expected }]);
    expect((await registry.getById("dep_a"))?.lifecycle).toMatchObject({ expiresAt: expected, extendedAt: NOW.toISOString() });
  });

  it("defaults to the deployment's original TTL", async () => {
    await registry.save(makeDeployment({ id: "dep_a" }));
    const result = await extendDeployment(ctx(new FakeProvider()), "dep_a", undefined, NOW);
    expect(result.deployment.lifecycle.expiresAt).toBe(new Date(NOW.getTime() + 3 * DAY).toISOString());
  });

  it("clamps the TTL to cleanup.maximum_ttl", async () => {
    await registry.save(makeDeployment({ id: "dep_a" }));
    const result = await extendDeployment(ctx(new FakeProvider()), "dep_a", "90d", NOW);
    expect(result).toMatchObject({ ttl: "14d", ttlClamped: true });
    expect(result.deployment.lifecycle.expiresAt).toBe(new Date(NOW.getTime() + 14 * DAY).toISOString());
  });

  it("never shortens an expiry", async () => {
    const later = new Date(NOW.getTime() + 10 * DAY).toISOString();
    await registry.save(makeDeployment({ id: "dep_a", lifecycle: { createdAt: NOW.toISOString(), expiresAt: later, ttl: "10d" } }));
    const provider = new FakeProvider();

    const result = await extendDeployment(ctx(provider), "dep_a", "1d", NOW);

    expect(result.extended).toBe(false);
    expect(provider.extended).toEqual([]);
    expect((await registry.getById("dep_a"))?.lifecycle.expiresAt).toBe(later);
  });

  it("refuses destroyed deployments", async () => {
    await registry.save(makeDeployment({ id: "dep_a", status: "destroyed" }));
    await expect(extendDeployment(ctx(new FakeProvider()), "dep_a", "3d", NOW)).rejects.toThrow(/destroyed/);
  });

  it("keeps an extended deployment out of a registry-less cleanup run", async () => {
    const original = makeDeployment({ id: "dep_a" });
    await registry.save(original);
    const provider = new FakeProvider();
    provider.remote = [structuredClone(original)];

    await extendDeployment(ctx(provider), "dep_a", "7d", NOW);

    // Simulate the scheduled Action: fresh registry, only provider state.
    const freshRegistry = new JsonFileRegistry(join(dir, "fresh.json"));
    const afterOldExpiry = new Date(NOW.getTime() + 2 * DAY);
    const result = await runCleanup({ ...ctx(provider), registry: freshRegistry }, afterOldExpiry);
    expect(result.destroyed).toEqual([]);
  });
});
