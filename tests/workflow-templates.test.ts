import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";
import { generatePagesWorkflow } from "../src/providers/github-pages/workflow-templates.js";

describe("generatePagesWorkflow", () => {
  it("produces syntactically valid YAML for a Vite project", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "portfolio-a83f21",
      packageManager: "npm",
    });
    const parsed = yaml.load(yamlText) as any;
    expect(parsed.name).toBeTruthy();
    expect(parsed.jobs.build).toBeDefined();
    expect(parsed.jobs.deploy).toBeDefined();
  });

  it("uses the official GitHub Pages actions", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "portfolio-a83f21",
      packageManager: "npm",
    });
    expect(yamlText).toContain("actions/checkout@v4");
    expect(yamlText).toContain("actions/configure-pages@v5");
    expect(yamlText).toContain("actions/upload-pages-artifact@v3");
    expect(yamlText).toContain("actions/deploy-pages@v4");
  });

  it("injects the CLI --base flag only for the default Vite build command", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "npm",
    });
    expect(yamlText).toContain('npm run build -- --base="$PAGES_BASE_PATH"');
  });

  it("leaves a custom build command untouched", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "pnpm build:preview", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "pnpm",
    });
    expect(yamlText).toContain("pnpm build:preview");
    expect(yamlText).not.toContain("--base=");
  });

  it("adds an SPA 404 fallback for static/generic/vite frameworks", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "STATIC",
      repositoryName: "my-repo",
      packageManager: "npm",
    });
    expect(yamlText).toContain("404.html");
  });

  it("skips the SPA fallback step for Astro (multi-page by convention)", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "ASTRO",
      repositoryName: "my-repo",
      packageManager: "npm",
    });
    expect(yamlText).not.toContain("404.html");
  });

  it("skips the Node setup/build steps for plain static sites with no command", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "true", output: "." },
      framework: "STATIC",
      repositoryName: "my-repo",
      packageManager: "npm",
    });
    expect(yamlText).not.toContain("actions/setup-node");
  });

  it("omits actions/setup-node's cache option when no lockfile is present (would otherwise hard-fail the run)", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "none",
    });
    expect(yamlText).toContain("actions/setup-node");
    expect(yamlText).not.toContain("cache: npm");
    expect(yamlText).not.toContain("cache: pnpm");
    expect(yamlText).not.toContain("cache: yarn");
  });

  it("enables setup-node's npm cache and uses npm ci when npm's lockfile is present", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "npm",
    });
    expect(yamlText).toContain("cache: npm");
    expect(yamlText).toContain("npm ci || npm install");
    expect(yamlText).not.toContain("pnpm/action-setup");
  });

  it("uses pnpm/action-setup, cache: pnpm, and a frozen-lockfile install for pnpm projects", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "pnpm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "pnpm",
    });
    expect(yamlText).toContain("pnpm/action-setup@v4");
    expect(yamlText).toContain("cache: pnpm");
    expect(yamlText).toContain("pnpm install --frozen-lockfile || pnpm install");
    // pnpm/action-setup must run before actions/setup-node, or setup-node's
    // `cache: pnpm` has nothing to invoke to resolve the cache key.
    expect(yamlText.indexOf("pnpm/action-setup")).toBeLessThan(yamlText.indexOf("actions/setup-node"));
  });

  it("defaults to a Node version new enough for modern pnpm (>=22.13), not the deprecated Node 20", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "pnpm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "pnpm",
    });
    expect(yamlText).not.toContain('node-version: "20"');
    expect(yamlText).toContain('node-version: "22"');
  });

  it("uses cache: yarn and a frozen-lockfile install for yarn projects", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "yarn build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "yarn",
    });
    expect(yamlText).toContain("cache: yarn");
    expect(yamlText).toContain("yarn install --frozen-lockfile || yarn install");
    expect(yamlText).not.toContain("pnpm/action-setup");
  });

  it("injects the CLI --base flag for the default pnpm Vite build command too", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "pnpm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      packageManager: "pnpm",
    });
    expect(yamlText).toContain('pnpm run build -- --base="$PAGES_BASE_PATH"');
  });
});

describe("committed workflow files", () => {
  it("cleanup.yml is syntactically valid YAML with the expected schedule trigger", () => {
    const parsed = yaml.load(readFileSync(new URL("../.github/workflows/cleanup.yml", import.meta.url), "utf-8")) as any;
    expect(parsed.on.schedule[0].cron).toBeTruthy();
    expect(parsed.jobs.cleanup).toBeDefined();
  });
});
