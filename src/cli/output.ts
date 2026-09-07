import type { Deployment } from "../core/types.js";
import { formatRemaining } from "../core/ttl.js";

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

/** Simple fixed-width table renderer — no external dependency needed. */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  return [line(headers), ...rows.map(line)].join("\n");
}

export function statusIcon(status: Deployment["status"]): string {
  switch (status) {
    case "active":
      return "✓"; // check
    case "failed":
      return "✗"; // x
    case "destroyed":
      return "–"; // dash
    default:
      return "⚠"; // warning (in-progress states)
  }
}

export function renderPreviewTable(rows: Array<{ branch: string; deployment?: Deployment; error?: Error }>): string {
  const headers = ["Branch", "Deployment", "Status", "URL"];
  const tableRows = rows.map(({ branch, deployment, error }) => [
    branch,
    deployment?.target.repository ?? "—",
    error ? "FAILED" : deployment?.status === "active" ? "READY" : (deployment?.status ?? "unknown").toUpperCase(),
    deployment?.urls.preview ?? (error ? error.message : "—"),
  ]);
  return renderTable(headers, tableRows);
}

export function renderStatusTree(deployments: Deployment[]): string {
  const byProject = new Map<string, Deployment[]>();
  for (const d of deployments) {
    const list = byProject.get(d.name) ?? [];
    list.push(d);
    byProject.set(d.name, list);
  }

  const lines: string[] = [];
  for (const [project, list] of byProject) {
    lines.push(project);
    list.forEach((d, i) => {
      const isLast = i === list.length - 1;
      const label = d.source.ref.replace(/^design\//, "");
      const remaining = d.status === "destroyed" ? "" : `expires in ${formatRemaining(d.lifecycle.expiresAt)}`;
      lines.push(`${isLast ? "└──" : "├──"} ${label.padEnd(12)} ${statusIcon(d.status)} ${d.status.padEnd(10)} ${remaining}`);
    });
  }
  return lines.join("\n");
}
