import { useCallback } from "react";
import { BookOpen } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";
import { withUnistyles } from "react-native-unistyles";
import { usePaneContext } from "@/panels/pane-context";
import { definePanel, type PanelDescriptor, type PanelPresentation } from "@/panels/panel-registry";
import { WorkspaceReaderScreen } from "@/screens/workspace/reader/workspace-reader-screen";
import { navigateToAgent } from "@/utils/navigate-to-agent";

const ThemedBookOpen = withUnistyles(BookOpen);

export const readerPanelPresentation = {
  label: (t) => t("panels.reader.label", "Agent Reader (演进大盘)"),
  subtitle: (t) => t("panels.reader.subtitle", "演进脉络与架构纪要"),
  tooltip: (t) => t("panels.reader.label", "Agent Reader (全景演进大盘)"),
  icon: ThemedBookOpen,
} satisfies PanelPresentation;

function useReaderPanelDescriptor(): PanelDescriptor {
  const { t } = useTranslation();
  return {
    label: readerPanelPresentation.label(t),
    subtitle: readerPanelPresentation.subtitle(t),
    tooltip: readerPanelPresentation.tooltip(t),
    titleState: "ready",
    icon: readerPanelPresentation.icon,
    statusBucket: null,
  };
}

export function ReaderPanel() {
  const { target, serverId, workspaceId } = usePaneContext();
  invariant(target.kind === "reader", "ReaderPanel requires reader target");

  const handleNavigateToAgent = useCallback(
    (agentId: string) => navigateToAgent({ agentId, serverId }),
    [serverId],
  );

  return (
    <WorkspaceReaderScreen
      serverId={serverId}
      workspaceId={workspaceId}
      onNavigateToAgent={handleNavigateToAgent}
    />
  );
}

export const readerPanelRegistration = definePanel("reader", {
  component: ReaderPanel,
  presentation: readerPanelPresentation,
  useDescriptor: useReaderPanelDescriptor,
});
