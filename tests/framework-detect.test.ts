import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectFramework } from "../src/framework/detect.js";
import { ConfigError } from "../src/core/errors.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeProject(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "gdi-fw-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf-8");
  }
  return dir;
}

describe("detectFramework", () => {
  it("detects a plain static site with no package.json", () => {
    const project = makeProject({ "index.html": "<html></html>" });
    const result = detectFramework(project);
    expect(result.framework).toBe("STATIC");
  });

  it("detects Vite via vite.config.ts", () => {
    const project = makeProject({
      "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "vite.config.ts": "export default {}",
    });
    expect(detectFramework(project).framework).toBe("VITE");
  });

  it("detects Astro via astro.config.mjs", () => {
    const project = makeProject({
      "package.json": JSON.stringify({ scripts: { build: "astro build" } }),
      "astro.config.mjs": "export default {}",
    });
    expect(detectFramework(project).framework).toBe("ASTRO");
  });

  it("detects a static-exported Next.js app", () => {
    const project = makeProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = { output: 'export' }",
    });
    const result = detectFramework(project);
    expect(result.framework).toBe("NEXT_STATIC");
    expect(result.buildOutput).toBe("out");
  });

  it("rejects a Next.js app that is not statically exported", () => {
    const project = makeProject({
      "package.json": JSON.stringify({ dependencies: { next: "^14.0.0" } }),
      "next.config.js": "module.exports = {}",
    });
    expect(() => detectFramework(project)).toThrow(ConfigError);
  });

  it("falls back to GENERIC for an unrecognized build-based project", () => {
    const project = makeProject({
      "package.json": JSON.stringify({ scripts: { build: "webpack" } }),
    });
    expect(detectFramework(project).framework).toBe("GENERIC");
  });

  it("fails with an actionable error when nothing is detectable", () => {
    const project = makeProject({ "README.md": "hello" });
    expect(() => detectFramework(project)).toThrow(ConfigError);
  });
});
