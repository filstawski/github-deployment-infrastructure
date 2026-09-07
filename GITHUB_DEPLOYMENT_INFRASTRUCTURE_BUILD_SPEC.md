# GITHUB DEPLOYMENT INFRASTRUCTURE
## Reusable Claude Skill + Ephemeral Preview Deployment Platform

### Objective

Build a reusable Claude skill named `github-deployment-infrastructure` that can be installed/reused across web projects.

The system must create short-lived preview deployments from branches, primarily using GitHub Pages backed by disposable GitHub repositories.

Typical use case:

- A source repository contains multiple design branches.
- Example: `design/a`, `design/b`, `design/c`, etc.
- A command such as `preview design/a design/b design/c` creates independent temporary deployments.
- Each deployment lives for a configurable TTL, commonly 3 days.
- Each deployment gets its own repository under a configurable deployment owner/org, e.g. `surdic-deployments`.
- The deployment repository is configured for GitHub Pages.
- The system waits until the site is actually deployed and healthy.
- It returns preview URLs.
- A scheduled cleanup mechanism deletes expired deployment repositories automatically.
- The source repository remains untouched unless explicitly requested.

The implementation must be generic and reusable. Do NOT hard-code `surdic-deployments`, a specific project name, or a single framework.

---

# 1. Core Design Principles

1. Treat deployments as resources, not ad-hoc scripts.
2. Treat deployment repositories as disposable.
3. Never modify the source repository unless explicitly requested.
4. Never delete an unmanaged repository.
5. Every ephemeral deployment must have an expiration timestamp.
6. Cleanup must work independently of Claude.
7. Deployment success must mean the resulting URL was verified, not merely that an API call succeeded.
8. Provider-specific logic must be isolated behind a provider abstraction.
9. GitHub Pages is provider #1, but the architecture must allow future providers such as Vercel, Cloudflare Pages, Netlify, S3, or custom infrastructure.
10. Configuration must be project-local and optional.
11. Prefer idempotent operations.
12. Operations must be safe to retry.
13. Secrets/tokens must never be committed into repositories.
14. The implementation must produce useful machine-readable and human-readable output.
15. Optimize for use through Claude Code as well as direct CLI/script usage.

---

# 2. Repository Architecture

Create a central infrastructure repository with a structure similar to:

github-deployment-infrastructure/
├── SKILL.md
├── README.md
├── LICENSE
├── package.json              # if using Node
├── pyproject.toml            # if using Python instead
├── src/
│   ├── cli/
│   ├── core/
│   ├── providers/
│   │   └── github-pages/
│   ├── framework/
│   ├── registry/
│   ├── lifecycle/
│   ├── health/
│   ├── security/
│   └── dashboard/
├── templates/
│   ├── github-pages/
│   │   ├── static/
│   │   ├── vite/
│   │   ├── astro/
│   │   ├── next-static/
│   │   └── generic/
├── .github/
│   └── workflows/
│       └── cleanup.yml
├── examples/
│   ├── vite/
│   ├── static/
│   └── deployment.yml
└── tests/

Use the language/ecosystem that gives the cleanest maintainable implementation. Prefer a small, dependency-light CLI.

---

# 3. Claude Skill

Create `SKILL.md` that teaches Claude how to use the infrastructure.

The skill should expose these conceptual operations:

- `deploy`
- `preview`
- `update`
- `destroy`
- `status`
- `list`
- `cleanup`
- `logs`
- `healthcheck`

Claude should be able to reason about a request such as:

> Preview branches design/a, design/b, design/c for 3 days.

and translate it into multiple deployments.

Claude should understand that:

- source repo = canonical project
- deployment repo = disposable artifact
- deployment provider = configurable
- deployment ID = canonical identifier
- TTL = lifecycle policy
- cleanup = independent safety mechanism

The skill must contain explicit safety rules.

---

# 4. Project Configuration

Projects may optionally contain:

`.github/deployment.yml`

Example:

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
  command: npm run build
  output: dist

preview:
  healthcheck: /
```

Configuration requirements:

- `name` optional; derive from repository when omitted.
- `provider` defaults to `github-pages`.
- `deployment_owner` must be configurable.
- `ttl` must be configurable.
- `repository.prefix` must be configurable.
- framework detection should support `auto`.
- build command/output should be overridable.
- healthcheck path should be configurable.

Validate configuration before deployment.

---

# 5. Deployment Resource Model

Create a deployment model similar to:

```yaml
id: dep_01KXXXXXXXX
name: portfolio
source:
  repository: owner/source-repository
  ref: design/modern
  commit: abcdef123456
target:
  provider: github-pages
  owner: surdic-deployments
  repository: portfolio-a83f21
lifecycle:
  created_at: 2026-09-07T00:15:00Z
  expires_at: 2026-09-10T00:15:00Z
  ttl: 3d
status: active
urls:
  repository: ...
  preview: ...
metadata:
  managed_by: github-deployment-infrastructure
  version: 1
```

Use a collision-resistant deployment ID.

Use a shorter readable repository suffix derived from a secure random value or stable deployment identifier.

---

# 6. Deployment Lifecycle

Implement these states:

requested
→ provisioning
→ building
→ deploying
→ verifying
→ active
→ expiring
→ destroying
→ destroyed

Failures should be represented explicitly:

failed

A failed deployment must retain enough metadata to diagnose the problem.

---

# 7. Deploy Operation

Implement:

```text
deploy [source] [options]
```

Example:

```bash
deploy --branch design/modern --ttl 3d
```

The operation must:

1. Load project configuration.
2. Validate GitHub credentials/access.
3. Validate the source ref.
4. Detect framework if necessary.
5. Create a unique deployment ID.
6. Calculate `created_at` and `expires_at`.
7. Create the disposable GitHub repository.
8. Mark the repository as managed by this infrastructure.
9. Install/configure the appropriate GitHub Pages workflow.
10. Build/deploy the selected source.
11. Configure GitHub Pages.
12. Wait for the deployment workflow.
13. Verify the final URL.
14. Store/update deployment metadata.
15. Return deployment details.

Do not report success before the healthcheck succeeds.

---

# 8. Multi-Preview Operation

Implement:

```text
preview [branch1] [branch2] [branch3] ...
```

Example:

```bash
preview design/a design/b design/c --ttl 3d
```

Deploy all branches independently.

Return a concise table:

```text
CLIENT PREVIEWS

Branch       Deployment              Status    URL
design/a     portfolio-a83f21         READY     https://...
design/b     portfolio-c19d82         READY     https://...
design/c     portfolio-71e4aa         READY     https://...

Expires: 2026-09-10
```

If one deployment fails, do not hide the successful deployments.

---

# 9. Optional Preview Dashboard

Implement an optional dashboard feature.

For a multi-preview operation, support generating a simple static HTML dashboard containing:

- project name
- branch/design name
- deployment status
- preview link
- repository link
- expiration time
- deployment timestamp
- optional commit SHA

Example:

```text
Modern       [Open Preview]
Minimal      [Open Preview]
Editorial    [Open Preview]
Experimental [Open Preview]
```

The dashboard itself may be deployed through the same provider.

Do not make dashboard deployment mandatory for the core system.

---

# 10. GitHub Pages Provider

Implement a provider interface.

Conceptually:

```text
DeploymentProvider
├── create()
├── update()
├── destroy()
├── status()
├── logs()
├── healthcheck()
└── url()
```

Implement:

```text
GitHubPagesProvider
```

The GitHub provider should:

- create repositories through GitHub APIs/CLI
- configure Pages
- use GitHub Actions for builds/deployments where appropriate
- use official GitHub Pages Actions
- wait for workflow/deployment completion
- discover/construct the Pages URL
- healthcheck the URL
- delete only repositories that this infrastructure owns

Keep GitHub-specific code isolated.

---

# 11. GitHub Actions

Use GitHub Actions for deployment execution rather than depending on a developer's local machine staying online.

Generate workflows using templates.

Use official GitHub Pages workflow actions where appropriate, including:

- actions/checkout
- actions/configure-pages
- actions/upload-pages-artifact
- actions/deploy-pages

Pin third-party actions to secure versions/SHAs where practical.

The generated workflow should:

1. Checkout the deployment repository.
2. Install dependencies.
3. Build the project.
4. Upload the Pages artifact.
5. Deploy to GitHub Pages.

The implementation must account for projects whose build output is not `dist`.

---

# 12. Framework Detection

Implement automatic framework detection.

At minimum inspect:

- package.json
- vite.config.*
- astro.config.*
- next.config.*
- nuxt.config.*
- angular.json
- index.html

Support at least these classifications:

```text
STATIC
VITE
ASTRO
NEXT_STATIC
NUXT_STATIC
GENERIC
```

Do not assume that every JavaScript project can be deployed as static HTML.

For unsupported frameworks, fail with an actionable explanation and allow explicit configuration.

---

# 13. Static Site Requirements

For GitHub Pages deployments, account for the fact that project sites commonly live under a path such as:

```text
https://OWNER.github.io/REPOSITORY/
```

Build configuration must correctly handle:

- asset base paths
- SPA routing
- relative assets
- Vite base configuration
- static framework output
- 404 fallback where appropriate

Do not blindly deploy a build that will produce broken `/assets/...` URLs.

Provide framework-specific configuration hooks.

---

# 14. Update

Implement:

```text
update <deployment-id>
```

or equivalent.

It must reuse the existing deployment repository.

Do not create a new repository unless explicitly requested.

Update should:

1. Resolve the deployment.
2. Resolve its source ref.
3. Build the latest selected source.
4. Deploy the new version.
5. Verify health.
6. Update metadata.

Support:

```text
update dep_01KXYZ --ref design/modern
```

to optionally change the source ref.

---

# 15. Destroy

Implement:

```text
destroy <deployment-id>
```

Destroy must:

1. Resolve deployment.
2. Confirm it is managed by this infrastructure.
3. Confirm it belongs to the configured deployment owner.
4. Delete the deployment repository.
5. Mark the deployment destroyed in registry/state.

Never allow deletion of arbitrary repositories.

If the repository lacks the required managed marker, refuse deletion unless an explicit force mechanism exists.

---

# 16. Automatic Cleanup

This is a core requirement.

Implement:

```text
cleanup
```

Cleanup must discover expired managed deployments and destroy them.

Use a central scheduled GitHub Action so cleanup does not depend on Claude or a developer machine.

Example schedule:

```text
every 1–6 hours
```

The exact interval should be configurable.

Default:

```yaml
cleanup:
  enabled: true
  default_ttl: 3d
  maximum_ttl: 14d
  grace_period: 6h
  require_managed_marker: true
```

The cleanup process must be idempotent.

If a repository is already deleted, mark the deployment destroyed rather than failing.

---

# 17. Repository Safety Markers

Every managed repository should contain and/or expose metadata such as:

```text
managed-by: github-deployment-infrastructure
deployment-id: dep_01KXYZ
source-repository: owner/source
source-ref: design/modern
created-at: ...
expires-at: ...
```

Use GitHub repository topics where practical:

```text
deployment
ephemeral
managed-by-github-deployment-infrastructure
```

The cleanup process must only target repositories that clearly identify themselves as managed.

Never use a repository name prefix alone as proof of ownership.

---

# 18. Maximum TTL

Implement a hard maximum TTL.

Example:

```yaml
maximum_ttl: 14d
```

If a user asks for:

```text
ttl: 90d
```

reject it or clamp it according to configuration.

Do not silently create long-lived infrastructure.

Allow project owners to configure a lower maximum.

---

# 19. Registry / State

Implement a deployment registry.

The registry should allow:

- lookup by deployment ID
- lookup by repository
- lookup by source branch
- list active deployments
- list expired deployments
- state transitions
- audit information

The first implementation may use a simple JSON/YAML registry if appropriate.

However, design the registry behind an interface so it can later use:

- GitHub repository metadata
- a database
- S3
- KV storage
- another backend

Avoid coupling the core lifecycle to a single storage implementation.

---

# 20. Status

Implement:

```text
status
status <deployment-id>
```

Example:

```text
ACTIVE DEPLOYMENTS

portfolio
├── modern       ✓ healthy   expires in 2d 14h
├── minimal      ✓ healthy   expires in 2d 14h
└── editorial    ⚠ building  expires in 2d 14h
```

Status should be able to query the real provider rather than relying exclusively on stale local state.

---

# 21. Logs

Implement:

```text
logs <deployment-id>
```

Fetch relevant GitHub Actions/workflow logs or provide a useful link/reference to them.

If deployment failed, surface the most relevant error.

Avoid dumping huge logs by default.

Support:

```text
logs dep_01KXYZ --full
```

for full output.

---

# 22. Health Checks

Implement configurable health checks.

Default:

```text
GET /
```

Success criteria:

- DNS/URL resolves
- HTTP response is successful
- configurable timeout
- configurable retry count

Example:

```yaml
preview:
  healthcheck: /
  timeout: 10s
  retries: 10
  retry_delay: 5s
```

Support optional expected status codes.

---

# 23. Idempotency

Repeated commands should not create unnecessary duplicate deployments.

For example:

```text
deploy design/modern
```

when an active deployment already exists may:

- return the existing deployment, or
- create a new deployment only if explicitly requested.

Support a flag such as:

```text
--force-new
```

Define the behavior clearly in the skill documentation.

---

# 24. Authentication and Security

Do not commit credentials.

Support authentication through environment variables, GitHub CLI authentication, GitHub App credentials, or another secure mechanism.

Prefer least-privilege credentials.

Document the minimum permissions required.

The implementation must not print tokens or secrets.

Redact secrets from logs.

Add validation at startup that credentials have sufficient permissions.

---

# 25. GitHub Organization Support

Do not assume the deployment owner is the current user's personal account.

Support:

```yaml
github:
  deployment_owner: my-org
```

If the deployment owner is an organization, handle organization repository creation appropriately.

Validate access before starting a multi-deployment operation.

---

# 26. Naming

Repository names should be:

- deterministic enough to recognize
- unique
- URL-safe
- within GitHub naming constraints

Example:

```text
portfolio-a83f21
shop-preview-91c4e8
landing-page-c17aa9
```

Never use raw branch names without sanitization.

Avoid exposing sensitive source branch names if configuration says they are private.

---

# 27. Error Handling

Errors must be actionable.

Bad:

```text
Deployment failed.
```

Good:

```text
Deployment failed.

Project: portfolio
Branch: design/modern
Deployment: dep_01KXYZ

Step: build

Command:
npm run build

Error:
Could not resolve dependency "..."

Suggested action:
Run the build locally or configure build.command in
.github/deployment.yml.
```

Use distinct exit codes for:

- configuration error
- authentication error
- provider error
- build failure
- healthcheck failure
- cleanup failure

---

# 28. CLI Design

Provide a clean CLI.

Possible commands:

```bash
gdi deploy
gdi preview
gdi update
gdi destroy
gdi status
gdi list
gdi cleanup
gdi logs
gdi healthcheck
```

Support:

```bash
gdi --help
gdi --version
```

Support machine-readable output:

```bash
gdi preview ... --json
```

Example JSON:

```json
{
  "deployments": [
    {
      "id": "dep_01KXYZ",
      "branch": "design/modern",
      "repository": "portfolio-a83f21",
      "status": "active",
      "url": "https://...",
      "expires_at": "2026-09-10T00:15:00Z"
    }
  ]
}
```

---

# 29. Dry Run

Implement:

```bash
gdi preview ... --dry-run
```

It should show:

- repositories that would be created
- provider
- source refs
- TTL
- expiration times
- build configuration

No destructive or mutating operation should occur.

---

# 30. Concurrency

Multi-preview operations should deploy independently.

Use bounded concurrency rather than launching unlimited jobs.

Example default:

```yaml
concurrency:
  max_parallel_deployments: 4
```

If one deployment fails, continue with others.

---

# 31. Auditability

Record:

- deployment ID
- source repo
- source ref
- commit SHA
- target repo
- provider
- created timestamp
- expiration timestamp
- status
- destroy timestamp
- reason for destruction
- infrastructure version

Do not store secrets.

---

# 32. Provider Abstraction

Design the provider interface so the CLI does not contain GitHub-specific assumptions.

Conceptual interface:

```typescript
interface DeploymentProvider {
  create(request): Promise<Deployment>;
  deploy(deployment, request): Promise<void>;
  update(deployment, request): Promise<void>;
  destroy(deployment): Promise<void>;
  status(deployment): Promise<DeploymentStatus>;
  logs(deployment): Promise<DeploymentLogs>;
  healthcheck(deployment): Promise<HealthResult>;
  getUrl(deployment): Promise<string>;
}
```

Adapt this to the chosen implementation language.

Implement only GitHub Pages initially.

Add clear extension documentation for future providers.

---

# 33. Future Providers

Do not implement these now unless trivial, but make the architecture ready for:

```text
Vercel
Cloudflare Pages
Netlify
S3/CloudFront
custom VPS
Kubernetes
```

A future project should ideally be able to change:

```yaml
provider: github-pages
```

to:

```yaml
provider: cloudflare-pages
```

without changing the high-level deployment commands.

---

# 34. Tests

Write meaningful automated tests.

At minimum:

- configuration parsing
- framework detection
- naming/sanitization
- deployment ID generation
- TTL parsing
- maximum TTL enforcement
- lifecycle transitions
- registry operations
- managed repository safety checks
- cleanup selection
- healthcheck retry logic
- CLI argument parsing
- provider abstraction behavior

Where live GitHub tests are impractical, use mocks.

Provide an optional integration test mode for a real test organization.

---

# 35. Documentation

Create:

`README.md`

It must explain:

1. What the system does.
2. Installation.
3. GitHub authentication.
4. Required permissions.
5. Project configuration.
6. Deploying one preview.
7. Deploying multiple previews.
8. Updating.
9. Destroying.
10. Automatic cleanup.
11. Security model.
12. GitHub Pages limitations.
13. Adding another provider.
14. Troubleshooting.

Also provide:

`examples/deployment.yml`

with comments.

---

# 36. GitHub Pages Policy Awareness

This system is intended for temporary development/client-review previews.

Document that GitHub Pages should not be treated as unrestricted permanent commercial hosting.

The default use case is ephemeral previews with short TTLs.

The system should make temporary deployment the natural/default behavior.

Do not build features that encourage indefinite hosting.

---

# 37. Claude UX

The Claude skill should make natural-language requests easy.

Examples Claude should understand:

> Deploy the current branch for 3 days.

> Give me previews for all design/* branches.

> Redeploy the modern design.

> Show me all active previews.

> Delete the editorial preview.

> Clean up expired deployments.

> Create a client preview dashboard for these five branches.

Claude should translate these into the appropriate CLI/API operations.

If a destructive operation is requested, Claude should follow the safety rules.

---

# 38. Recommended Natural-Language Workflow

The ideal user experience should be:

```text
User:
Preview design/a design/b design/c for 3 days.

Claude:
Creates three deployment resources.

Claude:
✓ design/a
  https://...

✓ design/b
  https://...

✓ design/c
  https://...

All previews expire in 3 days.
```

Then:

```text
User:
Update design/b.

Claude:
Updates the existing deployment and verifies it.
```

Then:

```text
User:
What previews are running?

Claude:
Shows the active deployment table.
```

Then:

```text
User:
Clean them up.

Claude:
Destroys the requested managed deployments.
```

Automatic cleanup should still happen independently.

---

# 39. Implementation Order

Build in this order:

### Phase 1
- project structure
- configuration
- deployment model
- CLI
- GitHub authentication
- GitHub repository creation
- GitHub Pages provider
- static/Vite support
- healthchecks

### Phase 2
- multi-preview
- registry
- status
- update
- destroy
- cleanup
- scheduled GitHub Action

### Phase 3
- framework detection improvements
- dashboard
- logs
- JSON output
- dry-run
- concurrency
- stronger security validation

### Phase 4
- provider abstraction hardening
- extension documentation
- optional additional providers

Do not over-engineer Phase 4 before Phase 1/2 are functional.

---

# 40. Definition of Done

The implementation is complete when a fresh web project can contain:

```text
.github/deployment.yml
```

and the infrastructure can execute something equivalent to:

```bash
gdi preview design/a design/b design/c --ttl 3d
```

and produce:

```text
3 disposable GitHub repositories
3 working GitHub Pages sites
3 deployment records
3 expiration timestamps
```

with:

```bash
gdi status
```

showing them,

```bash
gdi update <id>
```

updating them,

```bash
gdi destroy <id>
```

safely deleting them,

and the scheduled cleanup workflow automatically deleting expired deployments.

---

# 41. Important Engineering Instruction

Do not merely create documentation or scaffolding.

Actually implement the working system.

Before declaring completion:

1. Run the unit tests.
2. Run lint/type checks where applicable.
3. Run CLI help.
4. Run configuration validation against an example.
5. Run a dry-run deployment.
6. Verify generated GitHub Actions workflow syntax.
7. Verify cleanup logic with mocked expired deployments.
8. Verify that unmanaged repositories cannot be deleted.
9. Verify JSON output.
10. Document anything that cannot be integration-tested without real GitHub credentials.

If GitHub credentials are available in the environment, perform a real end-to-end test using a clearly designated test deployment owner/repository namespace.

Do not perform destructive operations against unrelated repositories.

---

# 42. Final Goal

The finished project should feel like a small internal deployment platform rather than a collection of shell scripts.

The high-level mental model is:

```text
                         GDI
                          │
          ┌───────────────┼────────────────┐
          │               │                │
       Project A       Project B        Project C
          │               │                │
          ▼               ▼                ▼
       preview          preview          preview
          │               │                │
          ▼               ▼                ▼
    GitHub Pages     GitHub Pages     GitHub Pages
          │               │                │
          ▼               ▼                ▼
      temporary        temporary        temporary
        repos            repos            repos
          │               │                │
          └───────────────┼────────────────┘
                          ▼
                    TTL / Cleanup
                          │
                          ▼
                       deleted
```

The system must be reusable across projects, safe by default, provider-agnostic at the core, GitHub Pages-first in implementation, and optimized for ephemeral customer/design previews.

When implementation is complete, provide a concise summary of:
- files created
- commands available
- authentication requirements
- configuration example
- tests run
- anything requiring manual GitHub setup
