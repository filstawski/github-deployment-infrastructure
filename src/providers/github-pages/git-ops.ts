import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sep } from "node:path";
import { ProviderError } from "../../core/errors.js";

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  try {
    return execFileSync(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (err: any) {
    const stderr = err.stderr?.toString?.() ?? "";
    throw new ProviderError(`Command failed: ${cmd} ${args.join(" ")}\n${stderr}`, {
      command: `${cmd} ${args.join(" ")}`,
    });
  }
}

function authenticatedUrl(repo: string, token: string): string {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

export interface FetchedSource {
  dir: string;
  commit: string;
  cleanup: () => void;
}

/** Shallow-fetches a single ref (branch or SHA) of the source repository without cloning full history. */
export function fetchSourceRef(sourceRepository: string, ref: string, token: string): FetchedSource {
  const dir = mkdtempSync(join(tmpdir(), "gdi-source-"));
  run("git", ["init", "-q"], dir);
  run("git", ["remote", "add", "origin", authenticatedUrl(sourceRepository, token)], dir);
  run("git", ["fetch", "--depth", "1", "origin", ref], dir);
  run("git", ["checkout", "-q", "FETCH_HEAD"], dir);
  const commit = run("git", ["rev-parse", "FETCH_HEAD"], dir).trim();
  return {
    dir,
    commit,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export interface PreparedDeploymentContent {
  dir: string;
  cleanup: () => void;
}

/**
 * Copies fetched source content into a fresh working tree and adds the
 * generated GitHub Actions workflow plus a non-secret metadata marker file.
 */
export function prepareDeploymentContent(
  sourceDir: string,
  workflowYaml: string,
  metadata: Record<string, unknown>
): PreparedDeploymentContent {
  const dir = mkdtempSync(join(tmpdir(), "gdi-deploy-"));
  const excludedGitDir = join(sourceDir, ".git");
  cpSync(sourceDir, dir, {
    recursive: true,
    filter: (src) => src !== excludedGitDir && !src.startsWith(excludedGitDir + sep),
  });
  const workflowsDir = join(dir, ".github", "workflows");
  mkdirSync(workflowsDir, { recursive: true });
  writeFileSync(join(workflowsDir, "gdi-deploy.yml"), workflowYaml, "utf-8");
  writeFileSync(join(dir, ".gdi-deployment.json"), JSON.stringify(metadata, null, 2) + "\n", "utf-8");
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Initializes a fresh git repo in `dir` and force-pushes it as the sole commit to the deployment repo's main branch. */
export function pushAsInitialCommit(dir: string, targetRepository: string, token: string, message: string): string {
  run("git", ["init", "-q", "-b", "main"], dir);
  run("git", ["config", "user.email", "gdi@localhost"], dir);
  run("git", ["config", "user.name", "github-deployment-infrastructure"], dir);
  run("git", ["add", "-A"], dir);
  run("git", ["commit", "-q", "-m", message], dir);
  run("git", ["remote", "add", "origin", authenticatedUrl(targetRepository, token)], dir);
  run("git", ["push", "-q", "-f", "origin", "HEAD:main"], dir);
  return run("git", ["rev-parse", "HEAD"], dir).trim();
}
