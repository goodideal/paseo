import type {
  PluginButtonRegistration,
  PluginClientContext,
  PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { ReaderPanelView } from "./client/reader-panel.js";

function WorkspaceReaderPanelHost({ workspaceId, theme, navigation }: PluginWorkspacePanelProps) {
  return (
    <ReaderPanelView
      workspaceId={workspaceId}
      theme={theme}
      onOpenAgent={
        navigation?.openAgent ? (agentId: string) => navigation.openAgent({ agentId }) : undefined
      }
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    client.addWorkspacePanel({
      id: "workspace-reader",
      title: "Agent Reader",
      icon: "BookOpen",
      locations: ["workspace", "explorer"],
      Component: WorkspaceReaderPanelHost,
    }),
  );

  cleanups.push(
    client.addCommandCenterItem({
      id: "open-workspace-reader",
      title: "Open Agent Reader (Evolution Digest)",
      icon: "BookOpen",
      context: "workspace",
      onSelect({ workspace }) {
        client.openPanel("workspace-reader", { workspaceId: workspace.id });
      },
    }),
  );

  const headerButtons = new Map<string, PluginButtonRegistration>();
  let stopped = false;

  const registerHeaderBtn = (workspaceId: string) => {
    if (stopped) return;
    headerButtons.get(workspaceId)?.remove();
    const btn = client.addHeaderButton({
      id: "open-reader",
      workspaceId,
      button: {
        title: "Agent Reader",
        icon: "BookOpen",
        behavior: {
          kind: "action",
          onPress() {
            client.openPanel("workspace-reader", { workspaceId });
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
