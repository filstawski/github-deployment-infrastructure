import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ConfigError } from "../core/errors.js";
import type { Framework } from "../core/types.js";
import { detectPackageManager, runScript, type PackageManager } from "./package-manager.js";

export interface FrameworkDetectionResult {
  framework: Framework;
  buildCommand: string;
  buildOutput: string;
  reason: string;
  packageManager: PackageManager;
}

function hasAny(dir: string, files: string[]): string | undefined {
  return files.find((f) => existsSync(join(dir, f)));
}

function readPackageJson(dir: string): Record<string, any> | undefined {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * Detects the project framework by inspecting well-known config files and
 * package.json. Never assumes an arbitrary JS project can be shipped as
 * static HTML (spec section 12) — unsupported cases raise an actionable
 * ConfigError instead of guessing.
 */
export function detectFramework(dir: string): FrameworkDetectionResult {
  const pkg = readPackageJson(dir);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const packageManager = detectPackageManager(dir);

  const nextConfig = hasAny(dir, ["next.config.js", "next.config.mjs", "next.config.ts"]);
  const nuxtConfig = hasAny(dir, ["nuxt.config.js", "nuxt.config.ts"]);
  const astroConfig = hasAny(dir, ["astro.config.js", "astro.config.mjs", "astro.config.ts"]);
  const viteConfig = hasAny(dir, ["vite.config.js", "vite.config.ts", "vite.config.mjs"]);
  const angularJson = hasAny(dir, ["angular.json"]);
  const indexHtml = hasAny(dir, ["index.html"]);

  if (nextConfig || deps.next) {
    const cfg = nextConfig ? readFileSync(join(dir, nextConfig), "utf-8") : "";
    const isStaticExport = /output\s*:\s*['"]export['"]/.test(cfg);
    if (!isStaticExport) {
      throw new ConfigError(
        "Detected a Next.js project, but it is not configured for static export.",
        {
          suggestedAction:
            'Add `output: "export"` to next.config.js, or set build.framework explicitly in .github/deployment.yml if this app requires a Node.js server (not supported by GitHub Pages).',
        }
      );
    }
    return {
      framework: "NEXT_STATIC",
      buildCommand: runScript(packageManager, "build"),
      buildOutput: "out",
      reason: `next.config with output: "export" found`,
      packageManager,
    };
  }

  if (nuxtConfig || deps.nuxt) {
    return {
      framework: "NUXT_STATIC",
      buildCommand: runScript(packageManager, "generate"),
      buildOutput: "dist",
      reason: "nuxt.config detected (using `nuxt generate` for static output)",
      packageManager,
    };
  }

  if (astroConfig || deps.astro) {
    return {
      framework: "ASTRO",
      buildCommand: runScript(packageManager, "build"),
      buildOutput: "dist",
      reason: "astro.config detected",
      packageManager,
    };
  }

  if (viteConfig || deps.vite) {
    return {
      framework: "VITE",
      buildCommand: runScript(packageManager, "build"),
      buildOutput: "dist",
      reason: "vite.config detected",
      packageManager,
    };
  }

  if (angularJson) {
    throw new ConfigError("Detected an Angular project, which is not auto-supported yet.", {
      suggestedAction: "Set build.framework, build.command, and build.output explicitly in .github/deployment.yml.",
    });
  }

  if (indexHtml && !pkg) {
    return {
      framework: "STATIC",
      buildCommand: "true",
      buildOutput: ".",
      reason: "plain index.html with no package.json (no build step required)",
      packageManager,
    };
  }

  if (pkg?.scripts?.build) {
    return {
      framework: "GENERIC",
      buildCommand: runScript(packageManager, "build"),
      buildOutput: "dist",
      reason: "package.json with a build script, but no recognized framework config",
      packageManager,
    };
  }

  throw new ConfigError("Could not detect a supported framework for this project.", {
    suggestedAction:
      "Set build.framework, build.command, and build.output explicitly in .github/deployment.yml.",
  });
}
