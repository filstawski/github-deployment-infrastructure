import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../src/lifecycle/state-machine.js";

describe("deployment lifecycle state machine", () => {
  it("allows the canonical happy path", () => {
    const path: Array<[string, string]> = [
      ["requested", "provisioning"],
      ["provisioning", "building"],
      ["building", "deploying"],
      ["deploying", "verifying"],
      ["verifying", "active"],
      ["active", "expiring"],
      ["expiring", "destroying"],
      ["destroying", "destroyed"],
    ];
    for (const [from, to] of path) {
      expect(canTransition(from as any, to as any)).toBe(true);
    }
  });

  it("allows failure from any in-progress state", () => {
    for (const state of ["provisioning", "building", "deploying", "verifying", "active"]) {
      expect(canTransition(state as any, "failed")).toBe(true);
    }
  });

  it("allows retry (redeploy) from active without going through destroy", () => {
    expect(canTransition("active", "building")).toBe(true);
  });

  it("rejects skipping states", () => {
    expect(canTransition("requested", "active")).toBe(false);
    expect(canTransition("provisioning", "destroyed")).toBe(false);
  });

  it("treats destroyed as terminal", () => {
    expect(canTransition("destroyed", "provisioning")).toBe(false);
  });

  it("throws on invalid transitions via assertTransition", () => {
    expect(() => assertTransition("requested" as any, "destroyed" as any)).toThrow();
  });
});
