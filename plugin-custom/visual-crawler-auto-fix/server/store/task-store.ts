import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AnomalyRecord,
  CrawlTelemetry,
  FixDirective,
  HopRecord,
  Severity,
  WorkerSlot,
} from "../../shared/types.js";

interface SerializedState {
  telemetry: CrawlTelemetry;
  hops: HopRecord[];
  anomalies: AnomalyRecord[];
  directives: FixDirective[];
  slots: WorkerSlot[];
}

export class TaskStore {
  private filePath: string;
  private telemetry: CrawlTelemetry;
  private hops: HopRecord[] = [];
  private anomalies: AnomalyRecord[] = [];
  private directives: Map<string, FixDirective> = new Map();
  private slots: WorkerSlot[] = [];

  constructor(filePath: string, defaultConcurrency = 3) {
    this.filePath = filePath;
    this.telemetry = {
      state: "idle",
      currentHop: 0,
      maxHops: 50,
      activeUrl: "",
      totalAnomalies: 0,
      anomaliesBySeverity: {
        P0: 0,
        P1: 0,
        P2: 0,
        P3: 0,
      },
    };
    this.initSlots(defaultConcurrency);
    this.load();
  }

  private initSlots(concurrency: number) {
    this.slots = Array.from({ length: concurrency }, (_, i) => ({
      slotIndex: i,
      status: "idle",
    }));
  }

  public getTelemetry(): CrawlTelemetry {
    return { ...this.telemetry };
  }

  public updateTelemetry(patch: Partial<CrawlTelemetry>): void {
    this.telemetry = { ...this.telemetry, ...patch };
    this.persist();
  }

  public recordHop(hop: HopRecord): void {
    this.hops.push(hop);
    this.telemetry.currentHop = hop.hopNumber;
    this.telemetry.activeUrl = hop.url;
    this.persist();
  }

  public recordAnomaly(anomaly: AnomalyRecord): void {
    this.anomalies.push(anomaly);
    this.telemetry.totalAnomalies++;
    this.telemetry.anomaliesBySeverity[anomaly.severity] =
      (this.telemetry.anomaliesBySeverity[anomaly.severity] || 0) + 1;
    this.persist();
  }

  public getAnomalies(): AnomalyRecord[] {
    return [...this.anomalies];
  }

  public getDirectives(filter?: { severity?: Severity; status?: string }): FixDirective[] {
    let list = Array.from(this.directives.values());
    if (filter?.severity) {
      list = list.filter((d) => d.severity === filter.severity);
    }
    if (filter?.status) {
      list = list.filter((d) => d.status === filter.status);
    }
    return list.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public getDirective(id: string): FixDirective | undefined {
    return this.directives.get(id);
  }

  public upsertDirective(directive: FixDirective): void {
    this.directives.set(directive.id, directive);
    this.persist();
  }

  public getSlots(): WorkerSlot[] {
    return [...this.slots];
  }

  public updateSlot(slotIndex: number, patch: Partial<WorkerSlot>): void {
    if (this.slots[slotIndex]) {
      this.slots[slotIndex] = { ...this.slots[slotIndex], ...patch };
      this.persist();
    }
  }

  public setConcurrency(concurrency: number): void {
    const current = this.slots.length;
    if (concurrency > current) {
      for (let i = current; i < concurrency; i++) {
        this.slots.push({ slotIndex: i, status: "idle" });
      }
    } else if (concurrency < current) {
      this.slots = this.slots.slice(0, concurrency);
    }
    this.persist();
  }

  public clear(): void {
    this.hops = [];
    this.anomalies = [];
    this.directives.clear();
    this.telemetry = {
      state: "idle",
      currentHop: 0,
      maxHops: 50,
      activeUrl: "",
      totalAnomalies: 0,
      anomaliesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 },
    };
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i] = { slotIndex: i, status: "idle" };
    }
    this.persist();
  }

  private persist(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const data: SerializedState = {
        telemetry: this.telemetry,
        hops: this.hops,
        anomalies: this.anomalies,
        directives: Array.from(this.directives.values()),
        slots: this.slots,
      };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), "utf-8");
    } catch {
      // In-memory fallback if persistence fails
    }
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const data: SerializedState = JSON.parse(raw);
        if (data.telemetry) this.telemetry = data.telemetry;
        if (Array.isArray(data.hops)) this.hops = data.hops;
        if (Array.isArray(data.anomalies)) this.anomalies = data.anomalies;
        if (Array.isArray(data.directives)) {
          this.directives = new Map(data.directives.map((d) => [d.id, d]));
        }
        if (Array.isArray(data.slots) && data.slots.length > 0) {
          this.slots = data.slots;
        }
      }
    } catch {
      // Ignore corrupted cache, fallback to clean initial state
    }
  }
}
