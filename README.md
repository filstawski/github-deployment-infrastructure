# github-deployment-infrastructure (gdi)

A reusable, provider-agnostic platform for turning branches into
short-lived, disposable preview deployments — primarily GitHub Pages sites
backed by throwaway GitHub repositories. Install it once, reuse it across
any number of web projects.

```bash
gdi preview design/a design/b design/c --ttl 3d
```

produces three independent GitHub Pages previews, each in its own
disposable repository, each with an expiration timestamp, each cleaned up
automatically once expired.

See [SKILL.md](SKILL.md) for how Claude should use this system. This
document is for humans setting it up.

## 1. What this does

- Deploys one or more branches as independent preview sites, without
  touching the source repository.
- Uses GitHub Actions (not your laptop) to build and deploy, so previews
  keep working even if you close your terminal.
- Verifies the resulting URL actually responds before reporting success.
- Tracks every deployment (ID, source branch, commit, TTL, expiry) in a
  local registry, and can also reconstruct that state directly from GitHub
  (repo topics + a metadata file) if the registry isn't present.
- Deletes expired deployments automatically via a scheduled GitHub Action —
  independent of whether you or Claude are around.
- Refuses to delete anything it doesn't recognize as its own.

## 2. Installation

```bash
npm install
npm run build
npm link   # optional: makes `gdi` available globally
```

Or run it without linking: `node <path-to-repo>/bin/gdi.js ...`, or add it
as a dependency of your project and use `npx gdi ...`.

Requires Node.js 18+, `git`, and the [`gh` CLI](https://cli.github.com/)
(optional — only needed if you don't want to set a token via environment
variable).

## 3. GitHub authentication

`gdi` resolves a token in this order:

1. `GDI_GITHUB_TOKEN` environment variable
2. `GITHUB_TOKEN` environment variable
3. `GH_TOKEN` environment variable
4. `gh auth token` (the GitHub CLI's own stored credentials)

Nothing is ever written to disk or printed by `gdi` itself; secrets found
in error output are redacted.

## 4. Required permissions

**Classic personal access token:** `repo`, `workflow`, `delete_repo`.

**Fine-grained PAT or GitHub App**, scoped to the deployment-owner account
(or all repos it will create), needs:

- Administration: Read and write (create/delete repositories, manage Pages)
- Contents: Read and write (push deployment content)
- Pages: Read and write
- Workflows: Read and write

Use a token scoped to the **deployment owner** namespace only, not your
main GitHub account, if at all possible — this limits the blast radius of a
leaked token to disposable preview infrastructure.

## 5. Project configuration

Optional `.github/deployment.yml` in the source project. Only
`github.deployment_owner` is required; everything else has a default. Full
commented reference: [examples/deployment.yml](examples/deployment.yml).

```yaml
name: portfolio
provider: github-pages
github:
  deployment_owner: surdic-deployments
defaults:
  ttl: 3d
repository:
  prefix: portfolio
build:
  framework: auto
preview:
  healthcheck: /
```

## 6. Deploying one preview

```bash
gdi deploy --branch design/modern --ttl 3d
```

Runs framework detection, creates a disposable repository under
`deployment_owner`, pushes a generated GitHub Actions workflow alongside
your source at that branch, waits for the Pages deployment, and healthchecks
the resulting URL before reporting success.

## 7. Deploying multiple previews

```bash
gdi preview design/a design/b design/c --ttl 3d
```

```text
CLIENT PREVIEWS

Branch      Deployment                Status  URL
design/a    portfolio-design-a-a83f21  READY   https://surdic-deployments.github.io/portfolio-design-a-a83f21/
design/b    portfolio-design-b-c19d82  READY   https://surdic-deployments.github.io/portfolio-design-b-c19d82/
design/c    portfolio-design-c-71e4aa  READY   https://surdic-deployments.github.io/portfolio-design-c-71e4aa/

Expires: 2026-09-10
```

Deployments run with bounded concurrency (`concurrency.max_parallel_deployments`,
default 4) and one failing branch never hides the others' results. Add
`--dashboard` to also generate a static HTML page listing all of them.

## 8. Listing deployment URLs

```bash
gdi urls          # active deployments only
gdi urls --all    # include failed/expiring/destroyed too
gdi urls --json
```

```text
Branch                  Status  URL
design/a                active  https://surdic-deployments.github.io/portfolio-design-a-a83f21/
design/b                active  https://surdic-deployments.github.io/portfolio-design-b-c19d82/
main                    active  https://surdic-deployments.github.io/portfolio-main-9f21ab/
```

This is the "what are all my live preview links right now" command.
`gdi list` overlaps with it but shows *every* deployment ever created
(including expired/destroyed ones) with more per-row detail (deployment
ID, target repository); `gdi urls` is the filtered, just-the-links view —
reach for it when you (or whoever you're sharing previews with) just need
the URLs.

## 9. Updating

```bash
gdi update dep_01KXYZ
gdi update dep_01KXYZ --ref design/modern-v2   # also change the source ref
```

Reuses the existing deployment repository — never creates a new one.

## 10. Destroying

```bash
gdi destroy dep_01KXYZ
```

Refuses to delete any repository that isn't marked as managed by this
infrastructure (a `managed-by-github-deployment-infrastructure` GitHub
topic). There is no `--force` flag for bypassing this check — an unmanaged
repository must be deleted manually.

## 11. Automatic cleanup

Copy [.github/workflows/cleanup.yml](.github/workflows/cleanup.yml) into
your source repository and add a `GDI_GITHUB_TOKEN` repository secret with
the same permissions described above. It runs on a schedule (default: every
3 hours) and calls `gdi cleanup`, which:

- Discovers expired deployments from the local registry **and** directly
  from GitHub (by listing repositories under `deployment_owner` that carry
  the managed topic and reading their embedded metadata) — so it works
  correctly even on a fresh checkout that has never seen a local registry
  file.
- Destroys only expired, managed deployments.
- Is idempotent: if a repository is already gone, it's simply marked
  destroyed rather than treated as an error.

You can also run `gdi cleanup` manually at any time.

## 12. Security model

- Deployment repositories are created empty and public (GitHub Pages on
  free plans requires a public repo) — never put secrets in the source
  branches you preview.
- Repository ownership is verified via GitHub topics before any delete,
  never by repository name pattern alone.
- TTLs are hard-clamped to `cleanup.maximum_ttl` (default 14 days) —
  requesting a longer TTL doesn't grant one.
- Tokens are never committed, logged, or echoed; error output is redacted.
- Cleanup requires the managed-by marker by default
  (`cleanup.require_managed_marker: true`).

## 13. GitHub Pages limitations

- Vite projects get an automatic `--base` override; Astro, Next.js (static
  export), and Nuxt need to read the `PAGES_BASE_PATH` environment variable
  from their own config file. See `templates/github-pages/*/README.md` for
  the exact snippet per framework.
- A server-rendered Next.js/Nuxt app cannot be deployed here — only static
  export builds are supported. Framework detection will fail with an
  actionable message rather than deploying a broken site.
- Package manager is auto-detected from the lockfile present in the source
  branch (`pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json`/
  `npm-shrinkwrap.json` → npm, none → npm without a lockfile). The generated
  workflow matches: the right `actions/setup-node` cache option, the right
  install command, and — for pnpm specifically — a `pnpm/action-setup` step
  before Node is set up (pnpm has to be on `PATH` before `cache: pnpm` can
  resolve a cache key). Override with `build.command` in
  `.github/deployment.yml` if you need a different invocation entirely.
- The generated workflow's Node version defaults to 22, not whatever the
  source branch's own tooling expects — mainly because current pnpm
  releases require Node ≥22.13, and Node 20 is deprecated on GitHub-hosted
  runners anyway. Pass a different version via the provider options if a
  project genuinely needs an older Node for its build.
- GitHub Pages is not unrestricted permanent commercial hosting — this tool
  is designed around short-lived previews with an enforced maximum TTL, not
  production hosting. Don't route around that by continually extending TTLs.

## 14. Adding another provider

Implement `DeploymentProvider` (`src/core/types.ts`) — `create`, `deploy`,
`update`, `destroy`, `status`, `logs`, `healthcheck`, `getUrl`, and
optionally `listManaged` for registry-independent cleanup discovery. Wire
it up in `buildProvider()` (`src/core/orchestrator.ts`) behind the
project's `provider:` config value. No CLI or lifecycle code should need to
know which provider is active — see `src/providers/github-pages/` as the
reference implementation.

## 15. Troubleshooting

| Symptom | Likely cause |
|---|---|
| Exit code 2 | Configuration error — check `.github/deployment.yml` against the error's "Suggested action". |
| Exit code 3 | Auth error — re-run `gh auth login` or check your token's scopes/expiry. |
| Exit code 4 | Provider (GitHub API) error — often a permissions issue on the deployment owner. |
| Exit code 5 | Build failed — run the build command locally to reproduce, or `gdi logs <id> --full`. |
| Exit code 6 | Healthcheck failed after the workflow succeeded — usually a base-path/asset-path issue (see section 13) or a wrong `preview.healthcheck` path. |
| Exit code 7 | Cleanup couldn't destroy one or more expired deployments — check the reported error per deployment. |
| "Refusing to delete... missing the managed-by topic marker" | You're pointing `destroy`/`cleanup` at a repository this tool didn't create. This is intentional and has no bypass flag. |
| "Dependencies lock file is not found... Supported file patterns: package-lock.json, npm-shrinkwrap.json, yarn.lock" | You're on a version of this tool from before pnpm/yarn support was added — update it. If you still see this after updating, check that the branch actually has a lockfile committed. |
| "Failed to delete repository ...: Must have admin rights to Repository" on `destroy`/`cleanup` | Your token is missing `delete_repo` scope (classic PAT) or `Administration: write` (fine-grained/App) — see section 4. Deployments still get created and marked failed/expired correctly; only the actual repository deletion is blocked. Add the scope and re-run `destroy`/`cleanup`, or delete the listed repositories manually. |

## Testing

```bash
npm test          # unit tests (vitest)
npm run typecheck # strict TypeScript check
```

Live GitHub end-to-end testing isn't run automatically (it needs real
credentials and a real deployment-owner namespace); point `GDI_GITHUB_TOKEN`
and a test `.github/deployment.yml` at a disposable test org/account and run
the CLI directly if you want to verify the full flow end to end.
