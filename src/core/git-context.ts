import { execFileSync } from "node:child_process";
import { ConfigError } from "./errors.js";

function run(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/** Parses "owner/repo" out of a GitHub remote URL (https or ssh form). */
export function parseOwnerRepo(remoteUrl: string): string {
  const match = /github\.com[/:]([^/]+)\/(.+?)(\.git)?$/.exec(remoteUrl.trim());
  if (!match) {
    throw new ConfigError(`Could not parse a GitHub owner/repo from remote URL: ${remoteUrl}`, {
      suggestedAction: "Ensure the source repository's `origin` remote points at a github.com repository.",
    });
  }
  return `${match[1]}/${match[2]}`;
}

export function getCurrentSourceRepository(cwd = "."): string {
  const remoteUrl = run(["remote", "get-url", "origin"], cwd);
  return parseOwnerRepo(remoteUrl);
}

export function getCurrentBranch(cwd = "."): string {
  return run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
}
