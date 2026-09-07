import { Octokit } from "@octokit/rest";
import { AuthError, ProviderError } from "../../core/errors.js";

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token, userAgent: "github-deployment-infrastructure" });
}

/** Validates that the token can authenticate and, ideally, has access to the deployment owner. */
export async function validateCredentials(octokit: Octokit, deploymentOwner: string): Promise<void> {
  try {
    await octokit.users.getAuthenticated();
  } catch (err) {
    throw new AuthError("GitHub credentials are invalid or expired.", {
      suggestedAction: "Re-authenticate with `gh auth login` or refresh GITHUB_TOKEN.",
    });
  }

  try {
    await octokit.repos.listForOrg({ org: deploymentOwner, per_page: 1 }).catch(async () => {
      // Not an org (or no access as org) — verify it resolves to a user instead.
      await octokit.users.getByUsername({ username: deploymentOwner });
    });
  } catch {
    throw new AuthError(`Cannot access deployment owner "${deploymentOwner}".`, {
      suggestedAction: `Verify "${deploymentOwner}" exists and the token has access to create repositories there.`,
    });
  }
}

export async function ownerIsOrg(octokit: Octokit, owner: string): Promise<boolean> {
  try {
    const { data } = await octokit.users.getByUsername({ username: owner });
    return data.type === "Organization";
  } catch {
    return false;
  }
}

export async function createRepository(
  octokit: Octokit,
  owner: string,
  repoName: string,
  description: string,
  isOrg: boolean
): Promise<{ htmlUrl: string; defaultBranch: string }> {
  try {
    const { data } = isOrg
      ? await octokit.repos.createInOrg({ org: owner, name: repoName, description, private: false, auto_init: false })
      : await octokit.repos.createForAuthenticatedUser({ name: repoName, description, private: false, auto_init: false });
    return { htmlUrl: data.html_url, defaultBranch: data.default_branch ?? "main" };
  } catch (err: any) {
    throw new ProviderError(`Failed to create repository ${owner}/${repoName}: ${err.message ?? err}`, {
      suggestedAction: "Verify the token has permission to create repositories under the deployment owner.",
    });
  }
}

export async function setTopics(octokit: Octokit, owner: string, repo: string, topics: string[]): Promise<void> {
  await octokit.repos.replaceAllTopics({ owner, repo, names: topics });
}

export async function getRepoTopics(octokit: Octokit, owner: string, repo: string): Promise<string[]> {
  const { data } = await octokit.repos.getAllTopics({ owner, repo });
  return data.names;
}

export async function repositoryExists(octokit: Octokit, owner: string, repo: string): Promise<boolean> {
  try {
    await octokit.repos.get({ owner, repo });
    return true;
  } catch (err: any) {
    if (err.status === 404) return false;
    throw err;
  }
}

export async function enablePagesWorkflowBuild(octokit: Octokit, owner: string, repo: string): Promise<void> {
  try {
    await octokit.request("POST /repos/{owner}/{repo}/pages", {
      owner,
      repo,
      build_type: "workflow",
    });
  } catch (err: any) {
    if (err.status === 409) return; // already enabled
    throw new ProviderError(`Failed to enable GitHub Pages for ${owner}/${repo}: ${err.message ?? err}`);
  }
}

export async function getPagesInfo(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<{ url: string; status: string | null } | undefined> {
  try {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/pages", { owner, repo });
    if (!data.html_url) return undefined;
    return { url: data.html_url, status: data.status ?? null };
  } catch (err: any) {
    if (err.status === 404) return undefined;
    throw err;
  }
}

export async function deleteRepository(octokit: Octokit, owner: string, repo: string): Promise<void> {
  try {
    await octokit.repos.delete({ owner, repo });
  } catch (err: any) {
    if (err.status === 404) return; // already gone — idempotent (spec section 16)
    throw new ProviderError(`Failed to delete repository ${owner}/${repo}: ${err.message ?? err}`, {
      suggestedAction: "Verify the token has delete_repo scope (classic PAT) or Administration:write (fine-grained/App).",
    });
  }
}

/** Lists every repository under an owner (paginated), used for registry-independent cleanup discovery. */
export async function listAllRepositoriesForOwner(octokit: Octokit, owner: string, isOrg: boolean) {
  const iterator = isOrg
    ? octokit.paginate.iterator(octokit.repos.listForOrg, { org: owner, per_page: 100, type: "all" })
    : octokit.paginate.iterator(octokit.repos.listForUser, { username: owner, per_page: 100, type: "all" });

  const repos: Array<{ name: string; topics?: string[] }> = [];
  for await (const { data } of iterator) {
    repos.push(...data);
  }
  return repos;
}

/** Reads and JSON-parses a small file from a repository, or undefined if absent/unparseable. */
export async function readJsonFile<T = unknown>(octokit: Octokit, owner: string, repo: string, path: string): Promise<T | undefined> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return undefined;
    const decoded = Buffer.from(data.content, "base64").toString("utf-8");
    return JSON.parse(decoded) as T;
  } catch (err: any) {
    if (err.status === 404) return undefined;
    throw err;
  }
}

export async function listRecentWorkflowRuns(octokit: Octokit, owner: string, repo: string, perPage = 5) {
  const { data } = await octokit.actions.listWorkflowRunsForRepo({ owner, repo, per_page: perPage });
  return data.workflow_runs;
}

/**
 * Returns a URL the user can open to download the full logs archive.
 * Requires following a redirect, so we surface the API endpoint rather
 * than the resolved signed URL (which expires quickly and would be
 * confusing to print).
 */
export function getWorkflowRunLogsEndpoint(owner: string, repo: string, runId: number): string {
  return `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`;
}
