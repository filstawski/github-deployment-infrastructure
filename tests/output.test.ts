import { describe, expect, it } from "vitest";
import { renderUrlsTable } from "../src/cli/output.js";
import type { Deployment } from "../src/core/types.js";

function makeDeployment(overrides: Partial<Deployment>): Deployment {
  return {
    id: overrides.id ?? "dep_x",
    name: "our-place",
    source: { repository: "owner/source", ref: "design/a" },
    target: { provider: "github-pages", owner: "deployments-org", repository: "our-place-a" },
    lifecycle: { createdAt: new Date().toISOString(), expiresAt: new Date().toISOString(), ttl: "14d" },
    status: "active",
    urls: { repository: "https://github.com/deployments-org/our-place-a" },
    metadata: { managedBy: "github-deployment-infrastructure", version: 1 },
    ...overrides,
  };
}

describe("renderUrlsTable", () => {
  it("includes branch, status, and URL for each deployment", () => {
    const table = renderUrlsTable([
      makeDeployment({
        source: { repository: "owner/source", ref: "main" },
        status: "active",
        urls: { repository: "https://github.com/deployments-org/our-place-main", preview: "https://deployments-org.github.io/our-place-main/" },
      }),
      makeDeployment({
        source: { repository: "owner/source", ref: "design/pit-room" },
        status: "active",
        urls: { repository: "https://github.com/deployments-org/our-place-pit-room", preview: "https://deployments-org.github.io/our-place-pit-room/" },
      }),
    ]);
    expect(table).toContain("main");
    expect(table).toContain("https://deployments-org.github.io/our-place-main/");
    expect(table).toContain("design/pit-room");
    expect(table).toContain("https://deployments-org.github.io/our-place-pit-room/");
  });

  it("shows an em-dash placeholder for a deployment with no preview URL yet", () => {
    const table = renderUrlsTable([makeDeployment({ urls: { repository: "https://github.com/deployments-org/our-place-a" } })]);
    expect(table).toContain("—");
  });
});
