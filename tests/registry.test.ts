import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonFileRegistry } from "../src/registry/json-file-registry.js";
import type { Deployment } from "../src/core/types.js";

let dir: string;
let registry: JsonFileRegistry;

function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: overrides.id ?? "dep_test1",
    name: "portfolio",
    source: { repository: "owner/source", ref: "design/a", commit: "abc123" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "portfolio-a83f21" },
    lifecycle: {
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
      ttl: "1h",
    },
    status: "active",
    urls: { repository: "https://github.com/deployments-org/portfolio-a83f21" },
    metadata: { managedBy: "github-deployment-infrastructure", version: 1 },
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gdi-registry-"));
  registry = new JsonFileRegistry(join(dir, "registry.json"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("JsonFileRegistry", () => {
  it("saves and looks up by ID", async () => {
    const deployment = makeDeployment();
    await registry.save(deployment);
    expect(await registry.getById(deployment.id)).toEqual(deployment);
  });

  it("looks up by repository", async () => {
    const deployment = makeDeployment();
    await registry.save(deployment);
    const found = await registry.getByRepository("deployments-org", "portfolio-a83f21");
    expect(found?.id).toBe(deployment.id);
  });

  it("looks up by source branch", async () => {
    await registry.save(makeDeployment({ id: "dep_a", source: { repository: "owner/source", ref: "design/a" } }));
    await registry.save(makeDeployment({ id: "dep_b", source: { repository: "owner/source", ref: "design/b" } }));
    const matches = await registry.listBySourceBranch("owner/source", "design/a");
    expect(matches.map((d) => d.id)).toEqual(["dep_a"]);
  });

  it("lists active deployments only", async () => {
    await registry.save(makeDeployment({ id: "dep_active", status: "active" }));
    await registry.save(makeDeployment({ id: "dep_destroyed", status: "destroyed" }));
    const active = await registry.listActive();
    expect(active.map((d) => d.id)).toEqual(["dep_active"]);
  });

  it("lists expired deployments based on expiresAt", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    await registry.save(makeDeployment({ id: "dep_expired", lifecycle: { createdAt: past, expiresAt: past, ttl: "1h" } }));
    await registry.save(makeDeployment({ id: "dep_fresh", lifecycle: { createdAt: past, expiresAt: future, ttl: "1h" } }));
    const expired = await registry.listExpired();
    expect(expired.map((d) => d.id)).toEqual(["dep_expired"]);
  });

  it("does not re-flag an already-destroyed deployment as expired", async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    await registry.save(makeDeployment({ id: "dep_gone", status: "destroyed", lifecycle: { createdAt: past, expiresAt: past, ttl: "1h" } }));
    expect(await registry.listExpired()).toEqual([]);
  });

  it("deletes deployments", async () => {
    const deployment = makeDeployment();
    await registry.save(deployment);
    await registry.delete(deployment.id);
    expect(await registry.getById(deployment.id)).toBeUndefined();
  });
});
