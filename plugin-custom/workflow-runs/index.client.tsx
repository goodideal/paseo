import type { PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { WorkflowRunsPanelView } from "./client/workflow-runs-panel.js";

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    client.addWorkspacePanel({
      id: "workflow-runs",
      title: "Workflow Runs",
      icon: "Workflow",
      locations: ["workspace", "explorer"],
      Component: WorkflowRunsPanelView,
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "open-workflow-runs",
      title: "Open Workflow Runs (DAG Pipelines)",
      icon: "Workflow",
      context: "workspace",
      onSelect({ workspace }) {
        client.openPanel("workflow-runs", { workspaceId: workspace.id });
      },
    }),
  );

  const headerButtons = new Map<string, PluginButtonRegistration>();
  let stopped = false;

  const registerHeaderBtn = (workspaceId: string) => {
    if (stopped) return;
    headerButtons.get(workspaceId)?.remove();
    const btn = client.addHeaderButton({
      id: "open-workflow-runs",
      workspaceId,
      button: {
        title: "Workflow Runs",
        icon: "Workflow",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("workflow-runs", { workspaceId });
          },
        },
      },
    });
    headerButtons.set(workspaceId, btn);
  };

  if (client.paseo?.workspaces) {
    void client.paseo.workspaces
      .list({ subscribe: {} })
      .then(({ subscription }) => {
        subscription.subscribe({
          snapshot: ({ entries }) => {
            for (const btn of headerButtons.values()) btn.remove();
            headerButtons.clear();
            for (const ws of entries) registerHeaderBtn(ws.id);
          },
          update: (msg) => {
            if (msg.type !== "workspace_update") return;
            const update = msg.payload;
            if (update.kind === "remove") {
              headerButtons.get(update.id)?.remove();
              headerButtons.delete(update.id);
            } else if (update.kind === "upsert") {
              registerHeaderBtn(update.workspace.id);
            }
          },
        });
        return undefined;
      })
      .catch(() => undefined);
  }

  cleanups.push(() => {
    stopped = true;
    for (const btn of headerButtons.values()) btn.remove();
    headerButtons.clear();
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
