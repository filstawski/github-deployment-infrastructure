import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileRegistry } from "../src/registry/json-file-registry.js";
import { runCleanup } from "../src/core/orchestrator.js";
import type { Deployment, DeploymentProvider, ProjectConfig } from "../src/core/types.js";

let dir: string;
let registry: JsonFileRegistry;

function makeDeployment(overrides: Partial<Deployment>): Deployment {
  return {
    id: overrides.id ?? "dep_x",
    name: "portfolio",
    source: { repository: "owner/source", ref: "design/a" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "portfolio-x" },
    lifecycle: { createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), ttl: "3d" },
    status: "active",
    urls: { repository: "https://github.com/deployments-org/portfolio-x" },
    metadata: { managedBy: "github-deployment-infrastructure", version: 1 },
    ...overrides,
  };
}

/** A fake provider used purely to prove the orchestrator only depends on DeploymentProvider (spec section 32). */
class FakeProvider implements DeploymentProvider {
  readonly name = "fake";
  destroyed: string[] = [];
  failOn = new Set<string>();

  async create(): Promise<Deployment> {
    throw new Error("not used in this test");
  }
  async deploy(): Promise<void> {}
  async update(deployment: Deployment): Promise<Deployment> {
    return deployment;
  }
  async destroy(deployment: Deployment): Promise<void> {
    if (this.failOn.has(deployment.id)) throw new Error(`simulated failure for ${deployment.id}`);
    this.destroyed.push(deployment.id);
  }
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gdi-cleanup-"));
  registry = new JsonFileRegistry(join(dir, "registry.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("runCleanup (spec section 16)", () => {
  it("destroys only expired deployments, leaving active ones alone", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    await registry.save(makeDeployment({ id: "dep_expired", lifecycle: { createdAt: past, expiresAt: past, ttl: "3d" } }));
    await registry.save(makeDeployment({ id: "dep_fresh", lifecycle: { createdAt: past, expiresAt: future, ttl: "3d" } }));

    const provider = new FakeProvider();
    const result = await runCleanup({ config: makeConfig(), registry, provider, sourceRepository: "owner/source" });

    expect(result.destroyed.map((d) => d.id)).toEqual(["dep_expired"]);
    expect(provider.destroyed).toEqual(["dep_expired"]);
    expect(await registry.getById("dep_fresh")).toMatchObject({ status: "active" });
  });

  it("is a no-op when cleanup is disabled in config", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await registry.save(makeDeployment({ id: "dep_expired", lifecycle: { createdAt: past, expiresAt: past, ttl: "3d" } }));

    const provider = new FakeProvider();
    const config = makeConfig();
    config.cleanup.enabled = false;
    const result = await runCleanup({ config, registry, provider, sourceRepository: "owner/source" });

    expect(result.destroyed).toEqual([]);
    expect(provider.destroyed).toEqual([]);
  });

  it("continues cleaning up other deployments when one fails (spec section 8/30)", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await registry.save(makeDeployment({ id: "dep_ok", lifecycle: { createdAt: past, expiresAt: past, ttl: "3d" } }));
    await registry.save(makeDeployment({ id: "dep_bad", lifecycle: { createdAt: past, expiresAt: past, ttl: "3d" } }));

    const provider = new FakeProvider();
    provider.failOn.add("dep_bad");
    const result = await runCleanup({ config: makeConfig(), registry, provider, sourceRepository: "owner/source" });

    expect(result.destroyed.map((d) => d.id)).toEqual(["dep_ok"]);
    expect(result.failed.map((f) => f.deployment.id)).toEqual(["dep_bad"]);
  });

  it("is idempotent: re-running cleanup after all expired deployments are gone destroys nothing new", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await registry.save(makeDeployment({ id: "dep_expired", lifecycle: { createdAt: past, expiresAt: past, ttl: "3d" } }));

    const provider = new FakeProvider();
    const ctx = { config: makeConfig(), registry, provider, sourceRepository: "owner/source" };
    await runCleanup(ctx);
    const second = await runCleanup(ctx);

    expect(second.destroyed).toEqual([]);
    expect(provider.destroyed).toEqual(["dep_expired"]);
  });
});
