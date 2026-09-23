import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  approveDirectiveRpc,
  batchApproveRpc,
  getCrawlStatusRpc,
  getWorkerPoolStatusRpc,
  listDirectivesRpc,
  rejectDirectiveRpc,
  startCrawlRpc,
  stopCrawlRpc,
} from "../../shared/contracts.js";
import type { CrawlTelemetry, FixDirective, Severity, WorkerSlot } from "../../shared/types.js";
import { TelemetryHeader } from "./telemetry-header.js";
import { TriageBoard } from "./triage-board.js";
import { WorkerLanes } from "./worker-lanes.js";
import { styles } from "./styles.js";

const DEFAULT_TELEMETRY: CrawlTelemetry = {
  state: "idle",
  currentHop: 0,
  maxHops: 50,
  activeUrl: "",
  totalAnomalies: 0,
  anomaliesBySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 },
};

export function CrawlerDashboard(_props: Partial<PluginWorkspacePanelProps>) {
  const startCrawl = useRpc(startCrawlRpc);
  const stopCrawl = useRpc(stopCrawlRpc);
  const getCrawlStatus = useRpc(getCrawlStatusRpc);
  const listDirectives = useRpc(listDirectivesRpc);
  const approveDirective = useRpc(approveDirectiveRpc);
  const batchApprove = useRpc(batchApproveRpc);
  const rejectDirective = useRpc(rejectDirectiveRpc);
  const getWorkerPoolStatus = useRpc(getWorkerPoolStatusRpc);

  const [telemetry, setTelemetry] = useState<CrawlTelemetry>(DEFAULT_TELEMETRY);
  const [directives, setDirectives] = useState<FixDirective[]>([]);
  const [slots, setSlots] = useState<WorkerSlot[]>([
    { slotIndex: 0, status: "idle" },
    { slotIndex: 1, status: "idle" },
    { slotIndex: 2, status: "idle" },
  ]);

  const refreshAll = useCallback(async () => {
    try {
      const [statusRes, directivesRes, poolRes] = await Promise.all([
        getCrawlStatus({}),
        listDirectives({}),
        getWorkerPoolStatus({}),
      ]);

      if (statusRes?.telemetry) {
        setTelemetry(statusRes.telemetry);
      }
      if (directivesRes?.directives) {
        setDirectives(directivesRes.directives);
      }
      if (poolRes?.slots) {
        setSlots(poolRes.slots);
      }
    } catch {
      // Ignore background poll errors
    }
  }, [getCrawlStatus, listDirectives, getWorkerPoolStatus]);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(refreshAll, 3000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const handleStartCrawl = useCallback(
    async (maxHops: number) => {
      try {
        await startCrawl({
          targetUrl: "http://localhost:3000",
          maxHops,
          seedRoutes: ["/dashboard", "/settings", "/analytics"],
          maxConcurrency: 3,
          autoApproveP0: false,
        });
        await refreshAll();
      } catch (err) {
        console.error("Failed to start crawl:", err);
      }
    },
    [startCrawl, refreshAll],
  );

  const handleStopCrawl = useCallback(async () => {
    try {
      await stopCrawl({});
      await refreshAll();
    } catch (err) {
      console.error("Failed to stop crawl:", err);
    }
  }, [stopCrawl, refreshAll]);

  const handleApprove = useCallback(
    async (directiveId: string) => {
      try {
        await approveDirective({ directiveId });
        await refreshAll();
      } catch (err) {
        console.error("Failed to approve directive:", err);
      }
    },
    [approveDirective, refreshAll],
  );

  const handleReject = useCallback(
    async (directiveId: string) => {
      try {
        await rejectDirective({ directiveId });
        await refreshAll();
      } catch (err) {
        console.error("Failed to reject directive:", err);
      }
    },
    [rejectDirective, refreshAll],
  );

  const handleBatchApprove = useCallback(
    async (minSeverity: Severity) => {
      try {
        await batchApprove({ minSeverity });
        await refreshAll();
      } catch (err) {
        console.error("Failed to batch approve directives:", err);
      }
    },
    [batchApprove, refreshAll],
  );

  return (
    <View style={styles.container}>
      {/* 1. Header with Live Telemetry & Quick Run Controls */}
      <TelemetryHeader
        telemetry={telemetry}
        onStartCrawl={handleStartCrawl}
        onStopCrawl={handleStopCrawl}
      />

      {/* 2. Main Interactive Triage Board */}
      <TriageBoard
        directives={directives}
        onApprove={handleApprove}
        onReject={handleReject}
        onBatchApprove={handleBatchApprove}
      />

      {/* 3. Bottom Concurrency Worker Lanes (3 Workers) */}
      <WorkerLanes slots={slots} />
    </View>
  );
}
