import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SuperpowerTaskStep, RadarNodeStatus } from "../shared/types.js";

export interface SuperpowerPlanStatus {
  planSlug: string;
  planPath: string;
  tasks: SuperpowerTaskStep[];
  currentTaskId?: string;
}

export async function parseSuperpowerStatus(
  workspaceCwd: string,
): Promise<SuperpowerPlanStatus | null> {
  const plansDir = path.join(workspaceCwd, "docs", "superpowers", "plans");
  const sddBaseDir = path.join(workspaceCwd, ".superpowers", "sdd");

  let candidateSlug: string | null = null;
  let candidatePlanPath: string | null = null;

  // 1. Try to find active sdd workspace first
  try {
    const sddEntries = await fs.readdir(sddBaseDir, { withFileTypes: true });
    const sddDirs = sddEntries.filter((e) => e.isDirectory());
    if (sddDirs.length > 0) {
      // Pick the latest modified SDD dir
      let latestTime = 0;
      for (const d of sddDirs) {
        try {
          const stat = await fs.stat(path.join(sddBaseDir, d.name));
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            candidateSlug = d.name;
          }
        } catch {}
      }
    }
  } catch {}

  // 2. If candidateSlug found, try to locate its plan file
  if (candidateSlug) {
    const directPath = path.join(plansDir, `${candidateSlug}.md`);
    try {
      await fs.access(directPath);
      candidatePlanPath = directPath;
    } catch {}
  }

  // 3. Fallback: inspect docs/superpowers/plans/
  if (!candidatePlanPath) {
    try {
      const planEntries = await fs.readdir(plansDir, { withFileTypes: true });
      const planFiles = planEntries.filter((e) => e.isFile() && e.name.endsWith(".md"));
      let latestTime = 0;
      for (const f of planFiles) {
        try {
          const filePath = path.join(plansDir, f.name);
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            candidatePlanPath = filePath;
            candidateSlug = f.name.replace(/\.md$/, "");
          }
        } catch {}
      }
    } catch {}
  }

  if (!candidatePlanPath || !candidateSlug) {
    return null;
  }

  // 4. Parse the plan file
  let content = "";
  try {
    content = await fs.readFile(candidatePlanPath, "utf-8");
  } catch {
    return null;
  }

  const tasks = parsePlanTasks(content);
  if (tasks.length === 0) {
    return null;
  }

  // 5. Enhance with ledger.md if available
  const ledgerPath = path.join(sddBaseDir, candidateSlug, "ledger.md");
  try {
    const ledgerContent = await fs.readFile(ledgerPath, "utf-8");
    applyLedgerData(tasks, ledgerContent);
  } catch {}

  // 6. Find current task id
  let currentTaskId: string | undefined;
  for (const t of tasks) {
    if (t.status === "running" || t.status === "fixing" || t.status === "reviewing") {
      currentTaskId = t.id;
      break;
    }
  }
  if (!currentTaskId) {
    const firstPending = tasks.find((t) => t.status === "pending");
    if (firstPending) {
      currentTaskId = firstPending.id;
    }
  }

  return {
    planSlug: candidateSlug,
    planPath: path.relative(workspaceCwd, candidatePlanPath),
    tasks,
    currentTaskId,
  };
}

function parsePlanTasks(content: string): SuperpowerTaskStep[] {
  const lines = content.split("\n");
  const tasks: SuperpowerTaskStep[] = [];
  let currentTask: {
    id: string;
    title: string;
    checkedSteps: number;
    totalSteps: number;
  } | null = null;

  for (const line of lines) {
    const taskHeaderMatch = line.match(/^###?\s*Task\s*(\d+)[:.]\s*(.*)$/i);
    if (taskHeaderMatch) {
      if (currentTask) {
        tasks.push(finalizeTask(currentTask));
      }
      currentTask = {
        id: `task-${taskHeaderMatch[1]}`,
        title: taskHeaderMatch[2].trim(),
        checkedSteps: 0,
        totalSteps: 0,
      };
      continue;
    }

    if (currentTask) {
      const checkedMatch = line.match(/^\s*-\s*\[x\]/i);
      const uncheckedMatch = line.match(/^\s*-\s*\[\s*\]/i);
      if (checkedMatch) {
        currentTask.checkedSteps++;
        currentTask.totalSteps++;
      } else if (uncheckedMatch) {
        currentTask.totalSteps++;
      }
    }
  }

  if (currentTask) {
    tasks.push(finalizeTask(currentTask));
  }

  return tasks;
}

function finalizeTask(raw: {
  id: string;
  title: string;
  checkedSteps: number;
  totalSteps: number;
}): SuperpowerTaskStep {
  let status: RadarNodeStatus = "pending";
  if (raw.totalSteps > 0 && raw.checkedSteps === raw.totalSteps) {
    status = "completed";
  } else if (raw.checkedSteps > 0) {
    status = "running";
  }

  return {
    id: raw.id,
    title: raw.title,
    status,
    commits: [],
    rulings: [],
  };
}

function applyLedgerData(tasks: SuperpowerTaskStep[], ledgerContent: string) {
  const lines = ledgerContent.split("\n");
  let activeTaskIndex = -1;

  for (const line of lines) {
    const completeMatch = line.match(/Task\s*(\d+)[:.]\s*complete/i);
    if (completeMatch) {
      const idx = parseInt(completeMatch[1], 10) - 1;
      if (tasks[idx]) {
        tasks[idx].status = "completed";
        activeTaskIndex = idx;
        const commitMatch = line.match(/commits\s+([a-f0-9.]+)/i);
        if (commitMatch) {
          const parts = commitMatch[1]
            .split("..")
            .map((s) => s.trim())
            .filter(Boolean);
          tasks[idx].commits = Array.from(new Set([...(tasks[idx].commits || []), ...parts]));
        }
      }
      continue;
    }

    const fixMatch = line.match(/Task\s*(\d+)[:.]\s*fix\s+round\s+(\d+)\/(\d+)/i);
    if (fixMatch) {
      const idx = parseInt(fixMatch[1], 10) - 1;
      if (tasks[idx]) {
        tasks[idx].status = "fixing";
        tasks[idx].currentRound = parseInt(fixMatch[2], 10);
        tasks[idx].maxRounds = parseInt(fixMatch[3], 10);
        activeTaskIndex = idx;
      }
      continue;
    }

    const rulingMatch = line.match(/(Ruling:.*)/i);
    if (rulingMatch) {
      const targetIdx = activeTaskIndex >= 0 ? activeTaskIndex : 0;
      if (tasks[targetIdx]) {
        tasks[targetIdx].rulings = tasks[targetIdx].rulings || [];
        tasks[targetIdx].rulings!.push(rulingMatch[1].trim());
      }
    }
  }
}
