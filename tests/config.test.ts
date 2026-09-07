import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/core/config.js";
import { ConfigError } from "../src/core/errors.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function writeConfig(yamlContents: string): string {
  dir = mkdtempSync(join(tmpdir(), "gdi-config-"));
  mkdirSync(join(dir, ".github"), { recursive: true });
  writeFileSync(join(dir, ".github", "deployment.yml"), yamlContents, "utf-8");
  return dir;
}

describe("loadConfig", () => {
  it("parses a full example and applies defaults", () => {
    const projectDir = writeConfig(`
name: portfolio
github:
  deployment_owner: surdic-deployments
defaults:
  ttl: 3d
repository:
  prefix: portfolio
`);
    const config = loadConfig(projectDir);
    expect(config.name).toBe("portfolio");
    expect(config.provider).toBe("github-pages");
    expect(config.github.deploymentOwner).toBe("surdic-deployments");
    expect(config.defaults.ttl).toBe("3d");
    expect(config.build.framework).toBe("auto");
    expect(config.preview.path).toBe("/");
    expect(config.cleanup.maximumTtl).toBe("14d");
    expect(config.concurrency.maxParallelDeployments).toBe(4);
  });

  it("derives name from the project directory when omitted", () => {
    const projectDir = writeConfig(`
github:
  deployment_owner: my-org
`);
    const config = loadConfig(projectDir);
    expect(config.name.length).toBeGreaterThan(0);
  });

  it("rejects missing deployment_owner", () => {
    const projectDir = writeConfig(`
name: portfolio
`);
    expect(() => loadConfig(projectDir)).toThrow(ConfigError);
  });

  it("rejects an invalid repository prefix", () => {
    const projectDir = writeConfig(`
name: portfolio
github:
  deployment_owner: my-org
repository:
  prefix: "not a valid prefix!"
`);
    expect(() => loadConfig(projectDir)).toThrow(ConfigError);
  });

  it("rejects an unparseable maximum_ttl", () => {
    const projectDir = writeConfig(`
github:
  deployment_owner: my-org
cleanup:
  maximum_ttl: forever
`);
    expect(() => loadConfig(projectDir)).toThrow(ConfigError);
  });

  it("rejects malformed YAML with an actionable error", () => {
    const projectDir = writeConfig(`name: [unterminated`);
    expect(() => loadConfig(projectDir)).toThrow(ConfigError);
  });
});
