import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, StyleSheet, Switch } from "react-native";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  type QuickPromptItem,
  type QuickPromptTriggerType,
  DEFAULT_QUICK_PROMPT_ITEMS,
} from "../shared/contracts.js";

export interface QuickPromptsModalProps {
  visible: boolean;
  onClose: () => void;
  projectId?: string | null;
  globalItems: QuickPromptItem[];
  projectItems?: QuickPromptItem[];
  disabledGlobalIds?: string[];
  order?: string[];
  onSaveGlobalItems: (items: QuickPromptItem[]) => Promise<void>;
  onResetGlobalDefaults: () => Promise<void>;
  onSaveProjectConfig?: (config: {
    items?: QuickPromptItem[];
    disabledGlobalIds?: string[];
    order?: string[];
  }) => Promise<void>;
  theme?: PluginTheme;
}

type ModalViewMode = "list" | "edit" | "create";
type ScopeTab = "project" | "global";

interface PromptFormState {
  label: string;
  content: string;
  shortcut: string;
  triggerType: QuickPromptTriggerType;
  keywords: string;
  regex: string;
  agentProfiles: string;
}

const EMPTY_FORM: PromptFormState = {
  label: "",
  content: "",
  shortcut: "",
  triggerType: "fixed",
  keywords: "",
  regex: "",
  agentProfiles: "",
};

export const QuickPromptsModal = memo(function QuickPromptsModal({
  visible,
  onClose,
  projectId,
  globalItems,
  projectItems = [],
  disabledGlobalIds = [],
  order,
  onSaveGlobalItems,
  onResetGlobalDefaults,
  onSaveProjectConfig,
  theme,
}: QuickPromptsModalProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>(projectId ? "project" : "global");
  const [viewMode, setViewMode] = useState<ModalViewMode>("list");
  const [editingItem, setEditingItem] = useState<QuickPromptItem | null>(null);
  const [form, setForm] = useState<PromptFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const colors = useMemo(
    () => ({
      surface0: theme?.colors.surface0 ?? "#171717",
      surface1: theme?.colors.surface1 ?? "#262626",
      surface2: theme?.colors.surface2 ?? "#333333",
      border: theme?.colors.border ?? "#404040",
      foreground: theme?.colors.foreground ?? "#f3f4f6",
      foregroundMuted: theme?.colors.foregroundMuted ?? "#9ca3af",
      accent: theme?.colors.accent ?? "#3b82f6",
      statusDanger: theme?.colors.statusDanger ?? "#ef4444",
    }),
    [theme],
  );

  const handleOpenCreate = useCallback(() => {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setError(null);
    setViewMode("create");
  }, []);

  const handleOpenEdit = useCallback((item: QuickPromptItem) => {
    setEditingItem(item);
    setForm({
      label: item.label,
      content: item.content,
      shortcut: item.shortcut ?? "",
      triggerType: item.triggerType,
      keywords: (item.ruleCondition?.keywords ?? []).join(", "),
      regex: item.ruleCondition?.regex ?? "",
      agentProfiles: (item.ruleCondition?.agentProfiles ?? []).join(", "),
    });
    setError(null);
    setViewMode("edit");
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode("list");
    setEditingItem(null);
    setError(null);
  }, []);

  // Global toggle
  const handleToggleGlobalItem = useCallback(
    async (id: string) => {
      const updated = globalItems.map((item) =>
        item.id === id ? { ...item, enabled: !item.enabled } : item,
      );
      await onSaveGlobalItems(updated);
    },
    [globalItems, onSaveGlobalItems],
  );

  // Global delete
  const handleDeleteGlobalItem = useCallback(
    async (id: string) => {
      const updated = globalItems.filter((item) => item.id !== id);
      await onSaveGlobalItems(updated);
    },
    [globalItems, onSaveGlobalItems],
  );

  // Global move up/down
  const handleMoveGlobal = useCallback(
    async (id: string, direction: "up" | "down") => {
      const index = globalItems.findIndex((item) => item.id === id);
      if (index === -1) return;
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= globalItems.length) return;

      const updated = [...globalItems];
      const [moved] = updated.splice(index, 1);
      updated.splice(targetIndex, 0, moved);
      const reindexed = updated.map((item, idx) => ({ ...item, order: idx }));
      await onSaveGlobalItems(reindexed);
    },
    [globalItems, onSaveGlobalItems],
  );

  // Project toggle
  const handleToggleProjectItem = useCallback(
    async (id: string, isInheritedGlobal: boolean) => {
      if (!onSaveProjectConfig) return;
      if (isInheritedGlobal) {
        const isCurrentlyDisabled = disabledGlobalIds.includes(id);
        const newDisabled = isCurrentlyDisabled
          ? disabledGlobalIds.filter((dId) => dId !== id)
          : [...disabledGlobalIds, id];
        await onSaveProjectConfig({ disabledGlobalIds: newDisabled });
      } else {
        const updated = projectItems.map((item) =>
          item.id === id ? { ...item, enabled: !item.enabled } : item,
        );
        await onSaveProjectConfig({ items: updated });
      }
    },
    [disabledGlobalIds, onSaveProjectConfig, projectItems],
  );

  // Project delete
  const handleDeleteProjectItem = useCallback(
    async (id: string) => {
      if (!onSaveProjectConfig) return;
      const updated = projectItems.filter((item) => item.id !== id);
      await onSaveProjectConfig({ items: updated });
    },
    [onSaveProjectConfig, projectItems],
  );

  // Save form (create or edit)
  const handleSaveForm = useCallback(async () => {
    if (!form.label.trim()) {
      setError("Label is required / 标题不能为空");
      return;
    }
    if (!form.content.trim()) {
      setError("Content is required / 内容不能为空");
      return;
    }

    const keywords = form.keywords
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter(Boolean);

    const agentProfiles = form.agentProfiles
      .split(/[,，]/)
      .map((p) => p.trim())
      .filter(Boolean);

    const itemToSave: QuickPromptItem = {
      id: editingItem?.id ?? `qp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: form.label.trim(),
      content: form.content.trim(),
      shortcut: form.shortcut.trim() || undefined,
      triggerType: form.triggerType,
      ruleCondition:
        form.triggerType === "rule"
          ? {
              keywords: keywords.length > 0 ? keywords : undefined,
              regex: form.regex.trim() || undefined,
              agentProfiles: agentProfiles.length > 0 ? agentProfiles : undefined,
            }
          : undefined,
      enabled: editingItem ? editingItem.enabled : true,
      createdAt: editingItem?.createdAt ?? Date.now(),
      order: editingItem?.order ?? 999,
    };

    if (activeTab === "global") {
      let updated: QuickPromptItem[];
      if (viewMode === "edit" && editingItem) {
        updated = globalItems.map((item) => (item.id === editingItem.id ? itemToSave : item));
      } else {
        updated = [...globalItems, itemToSave];
      }
      await onSaveGlobalItems(updated);
    } else if (onSaveProjectConfig) {
      let updated: QuickPromptItem[];
      if (viewMode === "edit" && editingItem) {
        updated = projectItems.map((item) => (item.id === editingItem.id ? itemToSave : item));
      } else {
        updated = [...projectItems, itemToSave];
      }
      await onSaveProjectConfig({ items: updated });
    }

    setViewMode("list");
    setEditingItem(null);
    setError(null);
  }, [
    activeTab,
    editingItem,
    form,
    globalItems,
    onSaveGlobalItems,
    onSaveProjectConfig,
    projectItems,
    viewMode,
  ]);

  return (
    <Modal
      title="快速提示词 / Quick Prompts"
      open={visible}
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal.Content
        style={[styles.container, { backgroundColor: colors.surface0 }]}
        scrollable={viewMode === "list"}
      >
        {/* Scope Tabs */}
        {projectId && viewMode === "list" && (
          <View style={[styles.tabBar, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => setActiveTab("project")}
              style={[
                styles.tabItem,
                activeTab === "project" && { backgroundColor: colors.surface2 },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === "project" ? colors.accent : colors.foregroundMuted },
                ]}
              >
                项目专属 / Project
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setActiveTab("global")}
              style={[
                styles.tabItem,
                activeTab === "global" && { backgroundColor: colors.surface2 },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === "global" ? colors.accent : colors.foregroundMuted },
                ]}
              >
                全局通用 / Global
              </Text>
            </Pressable>
          </View>
        )}

        {viewMode === "list" ? (
          <View style={styles.listSection}>
            <View style={styles.actionHeader}>
              <Pressable
                onPress={handleOpenCreate}
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.primaryButtonText}>+ 新增提示词 / New</Text>
              </Pressable>
              {activeTab === "global" && (
                <Pressable
                  onPress={onResetGlobalDefaults}
                  style={[styles.secondaryButton, { borderColor: colors.border }]}
                >
                  <Text style={[styles.secondaryButtonText, { color: colors.foregroundMuted }]}>
                    重置默认 / Reset
                  </Text>
                </Pressable>
              )}
            </View>

            {/* List items */}
            {activeTab === "global" ? (
              globalItems.map((item, idx) => (
                <View
                  key={item.id}
                  style={[
                    styles.itemRow,
                    { backgroundColor: colors.surface1, borderColor: colors.border },
                  ]}
                >
                  <View style={styles.itemMain}>
                    <View style={styles.itemHeaderLine}>
                      <Switch
                        value={item.enabled}
                        onValueChange={() => handleToggleGlobalItem(item.id)}
                      />
                      <Text style={[styles.itemLabel, { color: colors.foreground }]}>
                        {item.label}
                      </Text>
                      {item.shortcut && (
                        <Text style={[styles.shortcutBadge, { color: colors.foregroundMuted }]}>
                          /{item.shortcut}
                        </Text>
                      )}
                    </View>
                    <Text
                      style={[styles.itemContent, { color: colors.foregroundMuted }]}
                      numberOfLines={2}
                    >
                      {item.content}
                    </Text>
                  </View>
                  <View style={styles.itemButtons}>
                    <Pressable
                      disabled={idx === 0}
                      onPress={() => handleMoveGlobal(item.id, "up")}
                      style={styles.iconBtn}
                    >
                      <Text style={{ color: idx === 0 ? colors.border : colors.foreground }}>
                        ↑
                      </Text>
                    </Pressable>
                    <Pressable
                      disabled={idx === globalItems.length - 1}
                      onPress={() => handleMoveGlobal(item.id, "down")}
                      style={styles.iconBtn}
                    >
                      <Text
                        style={{
                          color: idx === globalItems.length - 1 ? colors.border : colors.foreground,
                        }}
                      >
                        ↓
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => handleOpenEdit(item)} style={styles.iconBtn}>
                      <Text style={{ color: colors.accent }}>✏️</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteGlobalItem(item.id)}
                      style={styles.iconBtn}
                    >
                      <Text style={{ color: colors.statusDanger }}>🗑️</Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              // Project Items + Inherited Globals
              <>
                {projectItems.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRow,
                      { backgroundColor: colors.surface1, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.itemMain}>
                      <View style={styles.itemHeaderLine}>
                        <Switch
                          value={item.enabled}
                          onValueChange={() => handleToggleProjectItem(item.id, false)}
                        />
                        <Text style={[styles.itemLabel, { color: colors.foreground }]}>
                          {item.label}
                        </Text>
                      </View>
                      <Text
                        style={[styles.itemContent, { color: colors.foregroundMuted }]}
                        numberOfLines={2}
                      >
                        {item.content}
                      </Text>
                    </View>
                    <View style={styles.itemButtons}>
                      <Pressable onPress={() => handleOpenEdit(item)} style={styles.iconBtn}>
                        <Text style={{ color: colors.accent }}>✏️</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleDeleteProjectItem(item.id)}
                        style={styles.iconBtn}
                      >
                        <Text style={{ color: colors.statusDanger }}>🗑️</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}

                {/* Inherited globals list */}
                {globalItems.map((item) => {
                  const isDisabledInProject = disabledGlobalIds.includes(item.id);
                  return (
                    <View
                      key={`global-${item.id}`}
                      style={[
                        styles.itemRow,
                        {
                          backgroundColor: colors.surface1,
                          borderColor: colors.border,
                          opacity: isDisabledInProject ? 0.5 : 1,
                        },
                      ]}
                    >
                      <View style={styles.itemMain}>
                        <View style={styles.itemHeaderLine}>
                          <Switch
                            value={!isDisabledInProject}
                            onValueChange={() => handleToggleProjectItem(item.id, true)}
                          />
                          <Text style={[styles.itemLabel, { color: colors.foreground }]}>
                            {item.label} (全局继承)
                          </Text>
                        </View>
                        <Text
                          style={[styles.itemContent, { color: colors.foregroundMuted }]}
                          numberOfLines={2}
                        >
                          {item.content}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        ) : (
          /* Form (Create / Edit) */
          <ScrollView style={styles.formSection}>
            {error && (
              <Text style={[styles.errorText, { color: colors.statusDanger }]}>{error}</Text>
            )}

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>按钮标题 / Label</Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              value={form.label}
              onChangeText={(text) => setForm((prev) => ({ ...prev, label: text }))}
              placeholder="e.g. Continue / 继续"
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              提示词内容 / Content
            </Text>
            <TextInput
              style={[
                styles.textInput,
                styles.textArea,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              value={form.content}
              onChangeText={(text) => setForm((prev) => ({ ...prev, content: text }))}
              placeholder="Enter full prompt content..."
              multiline
            />

            <Text style={[styles.fieldLabel, { color: colors.foreground }]}>
              斜杠快捷指令 / Shortcut
            </Text>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.border,
                  color: colors.foreground,
                },
              ]}
              value={form.shortcut}
              onChangeText={(text) => setForm((prev) => ({ ...prev, shortcut: text }))}
              placeholder="e.g. fix / continue (optional)"
            />

            <View style={styles.formButtonRow}>
              <Pressable
                onPress={handleBackToList}
                style={[styles.secondaryButton, { borderColor: colors.border }]}
              >
                <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                  取消 / Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={handleSaveForm}
                style={[styles.primaryButton, { backgroundColor: colors.accent }]}
              >
                <Text style={styles.primaryButtonText}>保存 / Save</Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </Modal.Content>
    </Modal>
  );
});

const styles = StyleSheet.create({
  container: {
    padding: 16,
    flex: 1,
  },
  tabBar: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden",
  },
  tabItem: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  tabText: {
    fontSize: 13,
    fontWeight: "600",
  },
  listSection: {
    gap: 8,
  },
  actionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 6,
  },
  itemMain: {
    flex: 1,
    gap: 4,
  },
  itemHeaderLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  itemLabel: {
    fontSize: 14,
    fontWeight: "600",
  },
  shortcutBadge: {
    fontSize: 12,
  },
  itemContent: {
    fontSize: 12,
  },
  itemButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 8,
  },
  iconBtn: {
    padding: 6,
  },
  formSection: {
    gap: 10,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
    marginBottom: 4,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  errorText: {
    fontSize: 12,
    marginBottom: 6,
  },
  formButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 16,
    marginBottom: 24,
  },
  primaryButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  secondaryButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 13,
  },
});
