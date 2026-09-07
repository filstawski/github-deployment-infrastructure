import { describe, expect, it } from "vitest";
import { program } from "../src/cli/index.js";

describe("CLI argument parsing", () => {
  it("registers all commands required by the spec", () => {
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(
      ["cleanup", "deploy", "destroy", "healthcheck", "list", "logs", "preview", "status", "update", "urls"].sort()
    );
  });

  it("requires a deployment-id argument for update/destroy/logs/healthcheck", () => {
    for (const name of ["update", "destroy", "logs", "healthcheck"]) {
      const cmd = program.commands.find((c) => c.name() === name)!;
      const requiredArgs = cmd.registeredArguments.filter((a) => a.required);
      expect(requiredArgs.length).toBeGreaterThan(0);
    }
  });

  it("accepts variadic branches for preview", () => {
    const cmd = program.commands.find((c) => c.name() === "preview")!;
    expect(cmd.registeredArguments.some((a) => a.variadic)).toBe(true);
  });

  it("exposes --ttl, --dry-run and --json flags on deploy", () => {
    const cmd = program.commands.find((c) => c.name() === "deploy")!;
    const flags = cmd.options.map((o) => o.long);
    expect(flags).toEqual(expect.arrayContaining(["--ttl", "--dry-run", "--json", "--force-new"]));
  });

  it("exposes --ref on update for optional source-ref changes", () => {
    const cmd = program.commands.find((c) => c.name() === "update")!;
    expect(cmd.options.map((o) => o.long)).toContain("--ref");
  });

  it("exposes --all and --json on urls", () => {
    const cmd = program.commands.find((c) => c.name() === "urls")!;
    expect(cmd.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--all", "--json"]));
  });
});
