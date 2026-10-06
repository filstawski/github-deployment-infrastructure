#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { loadConfig, resolveTtl } from "../core/config.js";
import { GdiError, ProviderError, redactSecrets } from "../core/errors.js";
import {
  createContext,
  deployBranch,
  destroyDeployment,
  extendDeployment,
  planDeploy,
  previewBranches,
  runCleanup,
  updateDeployment,
  validateAccess,
} from "../core/orchestrator.js";
import { printJson, renderPreviewTable, renderStatusTree, renderUrlsTable } from "./output.js";
import { formatRemaining } from "../core/ttl.js";
import { generateDashboardHtml } from "../dashboard/generate.js";
import { writeFileSync } from "node:fs";
import { getCurrentBranch } from "../core/git-context.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));

const program = new Command();
program.name("gdi").description("Ephemeral preview deployment platform (GitHub Pages-first).").version(pkg.version);

function handleError(err: unknown): never {
  if (err instanceof GdiError) {
    console.error(redactSecrets(err.format()));
    process.exit(err.exitCode);
  }
  console.error(redactSecrets(err instanceof Error ? (err.stack ?? err.message) : String(err)));
  process.exit(1);
}

program
  .command("deploy")
  .description("Deploy a single branch as an ephemeral preview.")
  .option("--branch <branch>", "Source branch/ref to deploy (defaults to the current git branch)")
  .option("--ttl <ttl>", "Time-to-live, e.g. 3d, 12h")
  .option("--force-new", "Create a new deployment even if one is already active for this branch", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--json", "Output machine-readable JSON", false)
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const branch: string = opts.branch ?? getCurrentBranch();

      if (opts.dryRun) {
        const plan = planDeploy(ctx, branch, { ttl: opts.ttl });
        opts.json ? printJson({ dryRun: true, plan }) : printDryRunPlan(plan);
        return;
      }

      await validateAccess(config);
      const deployment = await deployBranch(ctx, branch, { ttl: opts.ttl, forceNew: opts.forceNew });
      if (opts.json) {
        printJson({ deployment });
      } else {
        console.log(`✓ ${deployment.source.ref}`);
        console.log(`  ${deployment.urls.preview}`);
        console.log(`\nExpires: ${new Date(deployment.lifecycle.expiresAt).toLocaleDateString()}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("preview")
  .description("Deploy multiple branches as independent ephemeral previews.")
  .argument("<branches...>", "Branches/refs to preview")
  .option("--ttl <ttl>", "Time-to-live, e.g. 3d, 12h")
  .option("--force-new", "Create new deployments even if some are already active", false)
  .option("--dry-run", "Show what would happen without making changes", false)
  .option("--dashboard", "Generate a static HTML dashboard for these previews", false)
  .option("--dashboard-out <path>", "Path to write the dashboard HTML", "preview-dashboard.html")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (branches: string[], opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);

      if (opts.dryRun) {
        const plans = branches.map((b) => planDeploy(ctx, b, { ttl: opts.ttl }));
        opts.json ? printJson({ dryRun: true, plans }) : plans.forEach(printDryRunPlan);
        return;
      }

      await validateAccess(config);
      const results = await previewBranches(ctx, branches, { ttl: opts.ttl, forceNew: opts.forceNew });

      if (opts.json) {
        printJson({
          deployments: results.map((r) => ({
            branch: r.branch,
            repository: r.deployment?.target.repository,
            status: r.error ? "failed" : r.deployment?.status,
            url: r.deployment?.urls.preview,
            expires_at: r.deployment?.lifecycle.expiresAt,
            error: r.error?.message,
          })),
        });
      } else {
        console.log("CLIENT PREVIEWS\n");
        console.log(renderPreviewTable(results));
        const anyDeployment = results.find((r) => r.deployment)?.deployment;
        if (anyDeployment) {
          console.log(`\nExpires: ${new Date(anyDeployment.lifecycle.expiresAt).toLocaleDateString()}`);
        }
        const failures = results.filter((r) => r.error);
        if (failures.length > 0) {
          console.error(`\n${failures.length} of ${results.length} deployments failed. See above for details.`);
        }
      }

      if (opts.dashboard) {
        const deployments = results.map((r) => r.deployment).filter((d): d is NonNullable<typeof d> => Boolean(d));
        writeFileSync(opts.dashboardOut, generateDashboardHtml(config.name, deployments), "utf-8");
        if (!opts.json) console.log(`\nDashboard written to ${opts.dashboardOut}`);
      }

      if (results.some((r) => r.error)) process.exitCode = 1;
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("update")
  .description("Rebuild and redeploy an existing deployment.")
  .argument("<deployment-id>", "Deployment ID")
  .option("--ref <ref>", "Change the source ref before redeploying")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (deploymentId: string, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      await validateAccess(config);
      const deployment = await updateDeployment(ctx, deploymentId, opts.ref);
      opts.json ? printJson({ deployment }) : console.log(`✓ Updated ${deployment.id}\n  ${deployment.urls.preview}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("extend")
  .description("Push an active deployment's expiry out to now + TTL (clamped to cleanup.maximum_ttl).")
  .argument("<deployment-id>", "Deployment ID")
  .option("--ttl <ttl>", "New time-to-live from now, e.g. 7d (defaults to the deployment's original TTL)")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (deploymentId: string, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      await validateAccess(config);
      const result = await extendDeployment(ctx, deploymentId, opts.ttl);
      if (opts.json) {
        printJson(result);
        return;
      }
      const { deployment } = result;
      const expires = `${new Date(deployment.lifecycle.expiresAt).toLocaleString()} (in ${formatRemaining(deployment.lifecycle.expiresAt)})`;
      if (result.ttlClamped) {
        console.log(`! Requested TTL exceeds cleanup.maximum_ttl; using ${result.ttl}.`);
      }
      console.log(
        result.extended
          ? `✓ Extended ${deployment.id}\n  ${deployment.urls.preview ?? deployment.urls.repository}\n  Expires: ${expires}`
          : `- ${deployment.id} already expires later than now + ${result.ttl}; left unchanged.\n  Expires: ${expires}`
      );
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("destroy")
  .description("Permanently delete a managed deployment.")
  .argument("<deployment-id>", "Deployment ID")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (deploymentId: string, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      await validateAccess(config);
      const deployment = await destroyDeployment(ctx, deploymentId);
      opts.json ? printJson({ deployment }) : console.log(`✓ Destroyed ${deployment.id} (${deployment.target.repository})`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("status")
  .description("Show the status of one or all deployments.")
  .argument("[deployment-id]", "Deployment ID (omit to show all active deployments)")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (deploymentId: string | undefined, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);

      if (deploymentId) {
        const deployment = await ctx.registry.getById(deploymentId);
        if (!deployment) throw new ProviderError(`No deployment found with ID: ${deploymentId}`, { suggestedAction: "Run `gdi list` to see known deployment IDs." });
        const result = await ctx.provider.status(deployment);
        opts.json
          ? printJson(result)
          : console.log(
              `${deployment.id}\nBranch: ${deployment.source.ref}\nStatus: ${deployment.status}\nURL: ${deployment.urls.preview}\nExpires in: ${formatRemaining(deployment.lifecycle.expiresAt)}`
            );
        return;
      }

      const deployments = await ctx.registry.listActive();
      opts.json ? printJson({ deployments }) : console.log(deployments.length ? `ACTIVE DEPLOYMENTS\n\n${renderStatusTree(deployments)}` : "No active deployments.");
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("list")
  .description("List all known deployments.")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const deployments = await ctx.registry.list();
      opts.json
        ? printJson({ deployments })
        : deployments.forEach((d) =>
            console.log(`${d.id}  ${d.source.ref.padEnd(20)}  ${d.status.padEnd(10)}  ${d.urls.preview ?? "—"}`)
          );
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("urls")
  .description("List preview URLs for deployments (active ones only, by default).")
  .option("--all", "Include non-active deployments (failed, expiring, destroyed, ...) too", false)
  .option("--json", "Output machine-readable JSON", false)
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const deployments = await (opts.all ? ctx.registry.list() : ctx.registry.listActive());
      const sorted = [...deployments].sort((a, b) => a.source.ref.localeCompare(b.source.ref));

      if (opts.json) {
        printJson({
          urls: sorted.map((d) => ({ id: d.id, branch: d.source.ref, status: d.status, url: d.urls.preview ?? null })),
        });
        return;
      }

      if (sorted.length === 0) {
        console.log(opts.all ? "No deployments found." : "No active deployments found. Pass --all to include non-active ones.");
        return;
      }

      console.log(renderUrlsTable(sorted));
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("cleanup")
  .description("Destroy all expired managed deployments.")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const result = await runCleanup(ctx);
      if (opts.json) {
        printJson({
          destroyed: result.destroyed.map((d) => d.id),
          failed: result.failed.map((f) => ({ id: f.deployment.id, error: f.error.message })),
        });
      } else {
        console.log(`Destroyed ${result.destroyed.length} expired deployment(s).`);
        result.destroyed.forEach((d) => console.log(`  ✓ ${d.id} (${d.target.repository})`));
        if (result.failed.length > 0) {
          console.error(`Failed to destroy ${result.failed.length} deployment(s):`);
          result.failed.forEach((f) => console.error(`  ✗ ${f.deployment.id}: ${f.error.message}`));
        }
      }
      if (result.failed.length > 0) process.exitCode = 7;
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("logs")
  .description("Show recent deployment logs.")
  .argument("<deployment-id>", "Deployment ID")
  .option("--full", "Show full logs instead of a summary", false)
  .action(async (deploymentId: string, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const deployment = await ctx.registry.getById(deploymentId);
      if (!deployment) throw new ProviderError(`No deployment found with ID: ${deploymentId}`, { suggestedAction: "Run `gdi list` to see known deployment IDs." });
      const logs = await ctx.provider.logs(deployment, opts.full);
      console.log(logs.summary);
      if (logs.full) console.log(`\n${logs.full}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("healthcheck")
  .description("Run a healthcheck against a deployment's URL.")
  .argument("<deployment-id>", "Deployment ID")
  .option("--json", "Output machine-readable JSON", false)
  .action(async (deploymentId: string, opts) => {
    try {
      const config = loadConfig();
      const ctx = createContext(config);
      const deployment = await ctx.registry.getById(deploymentId);
      if (!deployment) throw new ProviderError(`No deployment found with ID: ${deploymentId}`, { suggestedAction: "Run `gdi list` to see known deployment IDs." });
      const result = await ctx.provider.healthcheck(deployment, config.preview);
      opts.json
        ? printJson(result)
        : console.log(result.healthy ? `✓ Healthy (${result.statusCode}) — ${result.url}` : `✗ Unhealthy — ${result.error}`);
      if (!result.healthy) process.exitCode = 6;
    } catch (err) {
      handleError(err);
    }
  });

function printDryRunPlan(plan: ReturnType<typeof planDeploy>): void {
  console.log(`[dry-run] ${plan.branch}`);
  console.log(`  provider:   github-pages`);
  console.log(`  owner:      ${plan.owner}`);
  console.log(`  repository: ${plan.repositoryName} (would be created)`);
  console.log(`  ttl:        ${plan.ttl}${plan.ttlClamped ? " (clamped to configured maximum)" : ""}`);
  console.log(`  framework:  ${plan.framework}`);
  if (plan.buildCommand) console.log(`  build cmd:  ${plan.buildCommand}`);
  if (plan.buildOutput) console.log(`  output dir: ${plan.buildOutput}`);
  console.log("");
}

export { program };

export function run(argv: string[] = process.argv): Promise<Command> {
  return program.parseAsync(argv);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  run();
}
