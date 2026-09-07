import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectPackageManager, installCommand, runScript } from "../src/framework/package-manager.js";

let dir: string;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeProject(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), "gdi-pm-"));
  for (const [path, contents] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, contents, "utf-8");
  }
  return dir;
}

describe("detectPackageManager", () => {
  it("detects pnpm from pnpm-lock.yaml", () => {
    const project = makeProject({ "pnpm-lock.yaml": "lockfileVersion: '9.0'" });
    expect(detectPackageManager(project)).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", () => {
    const project = makeProject({ "yarn.lock": "# yarn lockfile v1" });
    expect(detectPackageManager(project)).toBe("yarn");
  });

  it("detects npm from package-lock.json", () => {
    const project = makeProject({ "package-lock.json": "{}" });
    expect(detectPackageManager(project)).toBe("npm");
  });

  it("detects npm from npm-shrinkwrap.json", () => {
    const project = makeProject({ "npm-shrinkwrap.json": "{}" });
    expect(detectPackageManager(project)).toBe("npm");
  });

  it("returns none when no lockfile is present", () => {
    const project = makeProject({ "package.json": "{}" });
    expect(detectPackageManager(project)).toBe("none");
  });

  it("prefers pnpm over a stale package-lock.json when both are present", () => {
    const project = makeProject({ "pnpm-lock.yaml": "lockfileVersion: '9.0'", "package-lock.json": "{}" });
    expect(detectPackageManager(project)).toBe("pnpm");
  });
});

describe("runScript", () => {
  it("uses `npm run <script>` for npm and none", () => {
    expect(runScript("npm", "build")).toBe("npm run build");
    expect(runScript("none", "build")).toBe("npm run build");
  });

  it("uses `yarn <script>` for yarn", () => {
    expect(runScript("yarn", "build")).toBe("yarn build");
  });

  it("uses `pnpm run <script>` for pnpm", () => {
    expect(runScript("pnpm", "build")).toBe("pnpm run build");
  });
});

describe("installCommand", () => {
  it("falls back from ci to install for npm", () => {
    expect(installCommand("npm")).toBe("npm ci || npm install");
  });

  it("falls back from --frozen-lockfile for pnpm", () => {
    expect(installCommand("pnpm")).toBe("pnpm install --frozen-lockfile || pnpm install");
  });

  it("falls back from --frozen-lockfile for yarn", () => {
    expect(installCommand("yarn")).toBe("yarn install --frozen-lockfile || yarn install");
  });

  it("uses a plain npm install when there is no lockfile", () => {
    expect(installCommand("none")).toBe("npm install");
  });
});
