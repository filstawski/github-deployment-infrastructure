import { execFileSync } from "node:child_process";
import { AuthError } from "../../core/errors.js";

/**
 * Resolves a GitHub token from, in order: GDI_GITHUB_TOKEN, GITHUB_TOKEN,
 * GH_TOKEN, or the `gh` CLI's own stored auth. Never prints the resolved
 * token (spec section 24).
 */
export function resolveGitHubToken(): string {
  const fromEnv = process.env.GDI_GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (fromEnv) return fromEnv;

  try {
    const output = execFileSync("gh", ["auth", "token"], { encoding: "utf-8" }).trim();
    if (output) return output;
  } catch {
    // fall through to error below
  }

  throw new AuthError("No GitHub credentials found.", {
    suggestedAction:
      "Set GITHUB_TOKEN (or GDI_GITHUB_TOKEN) in the environment, or run `gh auth login` to authenticate the GitHub CLI.",
  });
}

/**
 * Minimum scopes/permissions required, documented for operators (spec
 * section 24). A classic PAT needs `repo`, `workflow`, and `delete_repo`;
 * a fine-grained PAT or GitHub App needs Administration (read/write),
 * Contents (read/write), Pages (read/write), and Workflows (read/write)
 * on repositories under the deployment owner.
 */
export const REQUIRED_SCOPES_DOC =
  "Classic PAT scopes: repo, workflow, delete_repo. " +
  "Fine-grained PAT / GitHub App permissions: Administration (RW), Contents (RW), Pages (RW), Workflows (RW).";
