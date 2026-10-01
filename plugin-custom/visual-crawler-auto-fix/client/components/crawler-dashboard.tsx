import React, { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import {
  getCrawlStatusRpc,
  getScheduleRpc,
  listTasksRpc,
  saveScheduleRpc,
  startCrawlRpc,
  stopCrawlRpc,
  updateTaskStatusRpc,
} from "../../shared/contracts.js";
import type { CrawlerTaskItem, CrawlTelemetry, TaskStatus } from "../../shared/types.js";
import { ConfigBar } from "./config-bar.js";
import { styles } from "./styles.js";
import { TaskBoard } from "./task-board.js";
import { TelemetryHeader } from "./telemetry-header.js";

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
  const listTasks = useRpc(listTasksRpc);
  const updateTaskStatus = useRpc(updateTaskStatusRpc);
  const saveSchedule = useRpc(saveScheduleRpc);
  const getSchedule = useRpc(getScheduleRpc);

  const [telemetry, setTelemetry] = useState<CrawlTelemetry>(DEFAULT_TELEMETRY);
  const [tasks, setTasks] = useState<CrawlerTaskItem[]>([]);

  // Configuration state
  const [targetUrl, setTargetUrl] = useState("http://localhost:3000");
  const [maxHops, setMaxHops] = useState(50);
  const [maxDepth, setMaxDepth] = useState(10);
  const [timeWindowEnabled, setTimeWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState("23:00");
  const [windowEnd, setWindowEnd] = useState("06:00");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const refreshAll = useCallback(async () => {
    try {
      const [statusRes, tasksRes] = await Promise.all([getCrawlStatus({}), listTasks({})]);

      if (statusRes?.telemetry) {
        setTelemetry(statusRes.telemetry);
      }
      if (tasksRes?.tasks) {
        setTasks(tasksRes.tasks);
      }
    } catch {
      // Ignore background poll errors
    }
  }, [getCrawlStatus, listTasks]);

  // Load initial schedule settings
  useEffect(() => {
    void (async () => {
      try {
        const scheduleRes = await getSchedule({});
        if (scheduleRes?.schedule) {
          if (scheduleRes.schedule.targetUrl) setTargetUrl(scheduleRes.schedule.targetUrl);
          if (scheduleRes.schedule.maxHops) setMaxHops(scheduleRes.schedule.maxHops);
          if (scheduleRes.schedule.maxDepth) setMaxDepth(scheduleRes.schedule.maxDepth);
          if (scheduleRes.schedule.timeWindow) {
            setTimeWindowEnabled(scheduleRes.schedule.timeWindow.enabled);
            setWindowStart(scheduleRes.schedule.timeWindow.startTime);
            setWindowEnd(scheduleRes.schedule.timeWindow.endTime);
          }
        }
      } catch {
        // Fall back to defaults
      }
    })();
  }, [getSchedule]);

  useEffect(() => {
    void refreshAll();
    const interval = setInterval(refreshAll, 3000);
    return () => clearInterval(interval);
  }, [refreshAll]);

  const handleStartCrawl = useCallback(
    async (hopsOverride?: number) => {
      try {
        const hops = typeof hopsOverride === "number" ? hopsOverride : maxHops;
        let origin = targetUrl;
        try {
          origin = new URL(targetUrl).origin;
        } catch {}

        await startCrawl({
          targetUrl,
          maxHops: hops,
          maxDepth,
          seedRoutes: [],
          maxConcurrency: 1,
          autoApproveP0: false,
          allowedOrigins: [origin],
          timeWindow: timeWindowEnabled
            ? { enabled: true, startTime: windowStart, endTime: windowEnd }
            : undefined,
          credentials: username && password ? { username, password } : undefined,
        });
        await refreshAll();
      } catch (err) {
        console.error("Failed to start crawl:", err);
      }
    },
    [
      startCrawl,
      refreshAll,
      targetUrl,
      maxHops,
      maxDepth,
      timeWindowEnabled,
      windowStart,
      windowEnd,
    ],
  );

  const handleStopCrawl = useCallback(async () => {
    try {
      await stopCrawl({});
      await refreshAll();
    } catch (err) {
      console.error("Failed to stop crawl:", err);
    }
  }, [stopCrawl, refreshAll]);

  const handleUpdateTaskStatus = useCallback(
    async (taskId: string, status: TaskStatus) => {
      try {
        await updateTaskStatus({ taskId, status });
        await refreshAll();
      } catch (err) {
        console.error("Failed to update task status:", err);
      }
    },
    [updateTaskStatus, refreshAll],
  );

  const handleSaveSchedule = useCallback(async () => {
    try {
      await saveSchedule({
        enabled: timeWindowEnabled,
        targetUrl,
        maxHops,
        maxDepth,
        timeWindow: {
          enabled: timeWindowEnabled,
          startTime: windowStart,
          endTime: windowEnd,
        },
      });
      await refreshAll();
    } catch (err) {
      console.error("Failed to save schedule:", err);
    }
  }, [
    saveSchedule,
    refreshAll,
    timeWindowEnabled,
    targetUrl,
    maxHops,
    maxDepth,
    windowStart,
    windowEnd,
  ]);

  return (
    <View style={styles.container}>
      {/* 1. Header with Live Telemetry */}
      <TelemetryHeader
        telemetry={telemetry}
        onStartCrawl={(hops) => void handleStartCrawl(hops)}
        onStopCrawl={handleStopCrawl}
      />

      {/* 2. Crawl & Night Schedule Configuration Bar */}
      <ConfigBar
        targetUrl={targetUrl}
        onChangeTargetUrl={setTargetUrl}
        maxHops={maxHops}
        onChangeMaxHops={setMaxHops}
        maxDepth={maxDepth}
        onChangeMaxDepth={setMaxDepth}
        timeWindowEnabled={timeWindowEnabled}
        onToggleTimeWindow={setTimeWindowEnabled}
        windowStart={windowStart}
        onChangeWindowStart={setWindowStart}
        windowEnd={windowEnd}
        onChangeWindowEnd={setWindowEnd}
        username={username}
        onChangeUsername={setUsername}
        password={password}
        onChangePassword={setPassword}
        isRunning={telemetry.state === "running"}
        onStartCrawl={() => void handleStartCrawl()}
        onStopCrawl={handleStopCrawl}
        onSaveSchedule={handleSaveSchedule}
      />

      {/* 3. Issue Task List Board */}
      <TaskBoard tasks={tasks} onUpdateStatus={handleUpdateTaskStatus} />
    </View>
  );
}
