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
      hasLockfile: true,
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
      hasLockfile: true,
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
      hasLockfile: true,
    });
    expect(yamlText).toContain('npm run build -- --base="$PAGES_BASE_PATH"');
  });

  it("leaves a custom build command untouched", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "pnpm build:preview", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      hasLockfile: true,
    });
    expect(yamlText).toContain("pnpm build:preview");
    expect(yamlText).not.toContain("--base=");
  });

  it("adds an SPA 404 fallback for static/generic/vite frameworks", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "STATIC",
      repositoryName: "my-repo",
      hasLockfile: true,
    });
    expect(yamlText).toContain("404.html");
  });

  it("skips the SPA fallback step for Astro (multi-page by convention)", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "ASTRO",
      repositoryName: "my-repo",
      hasLockfile: true,
    });
    expect(yamlText).not.toContain("404.html");
  });

  it("skips the Node setup/build steps for plain static sites with no command", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "true", output: "." },
      framework: "STATIC",
      repositoryName: "my-repo",
      hasLockfile: true,
    });
    expect(yamlText).not.toContain("actions/setup-node");
  });

  it("omits actions/setup-node's cache option when no lockfile is present (would otherwise hard-fail the run)", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      hasLockfile: false,
    });
    expect(yamlText).toContain("actions/setup-node");
    expect(yamlText).not.toContain("cache: npm");
  });

  it("enables setup-node's npm cache when a lockfile is present", () => {
    const yamlText = generatePagesWorkflow({
      build: { command: "npm run build", output: "dist" },
      framework: "VITE",
      repositoryName: "my-repo",
      hasLockfile: true,
    });
    expect(yamlText).toContain("cache: npm");
  });
});

describe("committed workflow files", () => {
  it("cleanup.yml is syntactically valid YAML with the expected schedule trigger", () => {
    const parsed = yaml.load(readFileSync(new URL("../.github/workflows/cleanup.yml", import.meta.url), "utf-8")) as any;
    expect(parsed.on.schedule[0].cron).toBeTruthy();
    expect(parsed.jobs.cleanup).toBeDefined();
  });
});
