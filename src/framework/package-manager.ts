import { existsSync } from "node:fs";
import { join } from "node:path";

export type PackageManager = "npm" | "yarn" | "pnpm" | "none";

/**
 * Detects the package manager from lockfile presence. pnpm-lock.yaml and
 * yarn.lock are checked before npm's own lockfile types since a project's
 * real package manager is a more reliable signal than an incidental
 * package-lock.json — and because actions/setup-node's `cache: npm` option
 * cannot read pnpm-lock.yaml/yarn.lock at all, so treating "any lockfile"
 * as "use npm caching" hard-fails pnpm/yarn projects in CI even though a
 * lockfile is genuinely present (the bug this module fixes).
 */
export function detectPackageManager(dir: string): PackageManager {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "package-lock.json")) || existsSync(join(dir, "npm-shrinkwrap.json"))) return "npm";
  return "none";
}

/** The conventional "run this package.json script" invocation for a given package manager. */
export function runScript(pm: PackageManager, script: string): string {
  switch (pm) {
    case "pnpm":
      return `pnpm run ${script}`;
    case "yarn":
      return `yarn ${script}`;
    case "npm":
    case "none":
    default:
      return `npm run ${script}`;
  }
}

/** The conventional "install exactly what the lockfile says, falling back if that's not possible" invocation. */
export function installCommand(pm: PackageManager): string {
  switch (pm) {
    case "pnpm":
      return "pnpm install --frozen-lockfile || pnpm install";
    case "yarn":
      return "yarn install --frozen-lockfile || yarn install";
    case "npm":
      return "npm ci || npm install";
    case "none":
    default:
      return "npm install";
  }
}
