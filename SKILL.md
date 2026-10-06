---
name: github-deployment-infrastructure
description: Create, update, list, and destroy short-lived GitHub Pages preview deployments from branches, with automatic TTL-based cleanup. Use when the user asks to preview, deploy, or share branches/designs as temporary URLs, or to manage/clean up such previews.
---

# github-deployment-infrastructure (gdi)

A reusable platform for turning branches into **short-lived, disposable
preview deployments** — primarily GitHub Pages sites backed by throwaway
GitHub repositories. It is installed once per machine/org and reused across
any number of web projects.

Read this whole file before running commands. It defines the mental model
and the safety rules you must follow.

## Mental model

| Term | Meaning |
|---|---|
| **source repository** | The canonical project repo (never modified by gdi unless explicitly asked). |
| **deployment repository** | A disposable repo under a configured "deployment owner", created purely to host one preview. Safe to delete. |
| **deployment provider** | Where the preview is hosted. Only `github-pages` exists today; the config's `provider` field is otherwise generic. |
| **deployment ID** | The canonical identifier for a deployment, e.g. `dep_01K5Z3Q8Y7X6QDG2QAZFN8M0R1`. Use this (not the repo name) when the user says "that deployment" and you need to reference it precisely. |
| **TTL** | How long a deployment lives before automatic cleanup destroys it. Clamped to a configured maximum — you cannot create indefinite hosting through this tool. |
| **cleanup** | An independent, scheduled process (a GitHub Action, not you) that deletes expired deployments. It runs whether or not you or the user are present. |

## Prerequisites before running any command

1. The project should have `.github/deployment.yml` (see
   `examples/deployment.yml` for a fully commented template). If it's
   missing, `github.deployment_owner` is required at minimum — ask the user
   for it rather than guessing an owner/org.
2. GitHub credentials must be available: `GITHUB_TOKEN`/`GDI_GITHUB_TOKEN`
   env var, or `gh auth login` already done. If `gdi` reports an auth error,
   tell the user and stop — do not attempt to invent or hardcode a token.
3. Run commands from the source project's working directory (the CLI reads
   `origin` from the local git remote to determine the source repository,
   and reads `.github/deployment.yml` relative to the current directory).

## Operations

All operations are exposed as the `gdi` CLI. Prefer `--json` when you need
to parse output programmatically; use the human-readable form when relaying
results directly to the user.

```bash
gdi deploy --branch <branch> [--ttl 3d] [--force-new] [--dry-run] [--json]
gdi preview <branch1> <branch2> ... [--ttl 3d] [--dashboard] [--dry-run] [--json]
gdi update <deployment-id> [--ref <branch>] [--json]
gdi extend <deployment-id> [--ttl 7d] [--json]
gdi destroy <deployment-id> [--json]
gdi status [deployment-id] [--json]
gdi list [--json]
gdi urls [--all] [--json]
gdi cleanup [--json]
gdi logs <deployment-id> [--full]
gdi healthcheck <deployment-id> [--json]
```

### Translating natural language

| User says | Do this |
|---|---|
| "Deploy the current branch for 3 days." | `gdi deploy --ttl 3d` (branch defaults to the current git branch). |
| "Preview design/a, design/b, design/c for 3 days." | `gdi preview design/a design/b design/c --ttl 3d` |
| "Give me previews for all design/* branches." | Enumerate matching local/remote branches yourself (e.g. `git branch -r | grep design/`), then call `gdi preview` with the resolved list. Confirm the branch list with the user first if it's large or ambiguous. |
| "Redeploy the modern design." | Find the matching deployment via `gdi list --json` (match on `source.ref` or repository name), then `gdi update <id>`. |
| "Keep that preview up another week." | Resolve the ID via `gdi list --json`, then `gdi extend <id> --ttl 7d`. The new expiry is *now + TTL* (not added to the old expiry), clamped to `cleanup.maximum_ttl`; report the resulting expiry date. If the output says it was left unchanged, the deployment already expires later than that. `gdi update` does **not** change expiry. |
| "Show me all active previews." | `gdi status` (tree view with per-branch expiry) or `gdi urls` (flat list of just the links) — pick based on whether they want status detail or just URLs to share. `gdi list` shows everything, including expired/destroyed, with more per-row detail than either. |
| "Give me a list of all the deployment URLs." | `gdi urls`. Add `--all` if they also want failed/expiring/destroyed ones, not just active. This is the direct answer to "what are all my live links right now" — don't hand-build this list yourself from `gdi list` output when this command exists. |
| "Delete the editorial preview." | Resolve the ID via `gdi list --json`, confirm with the user which one you mean if there's ambiguity, then `gdi destroy <id>`. This is destructive — see Safety rules. |
| "Clean up expired deployments." | `gdi cleanup`. This only ever touches already-expired, managed deployments — safe to run without extra confirmation. |
| "Create a client preview dashboard for these five branches." | `gdi preview <branches...> --dashboard --dashboard-out <path>`, then tell the user where the HTML file is (or offer to publish it). |

### Requesting a very long TTL

If a user asks for something like `ttl: 90d`, pass it through as requested —
`gdi` itself clamps it to the configured `cleanup.maximum_ttl` (default 14
days) and reports the clamp in its output. Tell the user the effective TTL
that was actually applied; do not silently accept a long TTL as if it were
granted.

### Idempotency

Running `deploy`/`preview` again for a branch that already has an active
deployment reuses it rather than creating a duplicate, unless `--force-new`
is passed. Mention this to the user if they seem to expect a fresh
deployment ("this reused the existing preview at the same URL — pass
--force-new if you wanted a brand new one").

## Safety rules (do not bypass)

1. **Never modify the source repository** as a side effect of a preview
   operation. If the user wants the source repo changed, that's a separate,
   explicit request.
2. **Never fabricate a deployment ID or repository name.** Always resolve
   real IDs via `gdi list`/`gdi status` before calling `update`/`destroy`.
3. **Confirm before destroying** a deployment the user didn't name precisely
   (e.g. "clean up the old one" when there are several candidates) — list
   the matches and ask which one, unless there's exactly one sensible match.
4. **`gdi cleanup` only destroys expired, managed deployments** — it cannot
   touch an active deployment or an unmanaged repository, so it's always
   safe to run proactively when asked to "clean things up."
5. **Do not treat GitHub Pages as permanent hosting.** If a user seems to
   want a long-term production site, say so explicitly and suggest a real
   hosting setup instead of stretching TTLs.
6. **Do not print or log tokens/secrets.** `gdi` already redacts these from
   its own error output; don't paste raw environment variables into chat.
7. **A destroy/cleanup failure is not silent** — if `gdi` reports a
   deployment it could not delete (e.g. missing managed-by marker), surface
   that to the user rather than declaring the operation fully successful.

## Output shapes worth knowing

- `gdi preview ... --json` returns `{ deployments: [{ branch, repository, status, url, expires_at, error }] }`.
- `gdi status --json` (single ID) returns `{ deployment, live: { workflowStatus, workflowConclusion, pagesUrl, health } }`.
- `gdi urls --json` returns `{ urls: [{ id, branch, status, url }] }` — active deployments only unless `--all` was passed.
- Exit codes distinguish failure classes: `2` config, `3` auth, `4` provider, `5` build, `6` healthcheck, `7` cleanup. Use these to decide whether to suggest a config fix vs. a re-auth vs. inspecting build logs.

## Automatic cleanup (independent of you)

Once `.github/workflows/cleanup.yml` is installed in the source repo (see
README "Automatic cleanup"), expired deployments are destroyed on a
schedule without any interaction from Claude or the developer. You do not
need to remind the user to run cleanup manually unless they ask, but you
should mention this workflow exists if they ask "will these get cleaned up
automatically?"
