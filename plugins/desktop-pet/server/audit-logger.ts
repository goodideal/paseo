import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AuditRecord } from "../shared/types.js";

export class AuditLogger {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  private async readAll(): Promise<AuditRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as AuditRecord[];
    } catch {
      return [];
    }
  }

  private async writeAll(records: AuditRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(records, null, 2), "utf-8");
  }

  public async append(record: AuditRecord): Promise<void> {
    const records = await this.readAll();
    records.unshift(record); // Newest first
    await this.writeAll(records);
  }

  public async list(options?: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  }): Promise<{ records: AuditRecord[]; total: number }> {
    let records = await this.readAll();
    if (options?.unreadOnly) {
      records = records.filter((r) => !r.reviewedByHuman);
    }
    const total = records.length;
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    const paginated = records.slice(offset, offset + limit);
    return { records: paginated, total };
  }

  public async markReviewed(id: string): Promise<boolean> {
    const records = await this.readAll();
    const target = records.find((r) => r.id === id);
    if (!target) return false;
    target.reviewedByHuman = true;
    await this.writeAll(records);
    return true;
  }
}
