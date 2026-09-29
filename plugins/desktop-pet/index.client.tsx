import type { PluginClientContext } from "@getpaseo/plugin/client";
import { AuditPanel } from "./client/audit-panel.js";
import { PetSettings } from "./client/pet-settings.js";

export default function contribute(client: PluginClientContext) {
  client.addSurface("pet-audit", AuditPanel);
  client.addSidebarItem({
    id: "pet-audit",
    title: "Pet Audit Log",
    icon: "ShieldAlert",
    surface: "pet-audit",
  });

  client.addSettingsScreen({
    id: "pet-settings",
    title: "Desktop Pet",
    icon: "Smile",
    Component: PetSettings,
  });

  return () => {};
}
