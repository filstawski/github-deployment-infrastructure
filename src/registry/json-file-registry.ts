import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Deployment, DeploymentStatus } from "../core/types.js";
import type { DeploymentRegistry } from "./registry.js";

interface RegistryFile {
  version: 1;
  deployments: Record<string, Deployment>;
}

/**
 * Simple JSON-file-backed registry (spec section 19). Adequate for a
 * single-machine / single-CI-runner use case; the interface allows
 * swapping in a remote backend later without touching callers.
 */
export class JsonFileRegistry implements DeploymentRegistry {
  constructor(private readonly filePath: string) {}

  private read(): RegistryFile {
    if (!existsSync(this.filePath)) {
      return { version: 1, deployments: {} };
    }
    const raw = readFileSync(this.filePath, "utf-8");
    if (!raw.trim()) return { version: 1, deployments: {} };
    return JSON.parse(raw) as RegistryFile;
  }

  private write(data: RegistryFile): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
  }

  async save(deployment: Deployment): Promise<void> {
    const data = this.read();
    data.deployments[deployment.id] = deployment;
    this.write(data);
  }

  async getById(id: string): Promise<Deployment | undefined> {
    return this.read().deployments[id];
  }

  async getByRepository(owner: string, repository: string): Promise<Deployment | undefined> {
    const data = this.read();
    return Object.values(data.deployments).find(
      (d) => d.target.owner === owner && d.target.repository === repository
    );
  }

  async listBySourceBranch(sourceRepository: string, ref: string): Promise<Deployment[]> {
    const data = this.read();
    return Object.values(data.deployments).filter(
      (d) => d.source.repository === sourceRepository && d.source.ref === ref
    );
  }

  async list(filter?: { status?: DeploymentStatus[] }): Promise<Deployment[]> {
    const data = this.read();
    let deployments = Object.values(data.deployments);
    if (filter?.status) {
      deployments = deployments.filter((d) => filter.status!.includes(d.status));
    }
    return deployments.sort((a, b) => a.lifecycle.createdAt.localeCompare(b.lifecycle.createdAt));
  }

  async listExpired(now: Date = new Date()): Promise<Deployment[]> {
    const deployments = await this.list();
    return deployments.filter(
      (d) => d.status !== "destroyed" && new Date(d.lifecycle.expiresAt).getTime() <= now.getTime()
    );
  }

  async listActive(): Promise<Deployment[]> {
    return this.list({ status: ["active", "provisioning", "building", "deploying", "verifying", "expiring"] });
  }

  async delete(id: string): Promise<void> {
    const data = this.read();
    delete data.deployments[id];
    this.write(data);
  }
}
