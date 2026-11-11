import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View, StyleSheet, Switch } from "react-native";
import { Icon, Modal, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import {
  type QuickPromptItem,
  type QuickPromptTriggerType,
  type QuickPromptColor,
  DEFAULT_QUICK_PROMPT_ITEMS,
} from "../shared/contracts.js";
import { PROMPT_COLOR_PALETTE, COMMON_PROMPT_ICONS } from "./color-palette.js";

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
  availableModels?: readonly { id: string; label: string }[];
  theme?: PluginTheme;
}

type ModalViewMode = "list" | "edit" | "create";
type ScopeTab = "project" | "global";

type ConfirmAction =
  | { type: "reset" }
  | { type: "delete"; id: string; label: string; scope: "global" | "project" }
  | null;

function useSafeToast() {
  try {
    return useToast();
  } catch (err) {
    console.error("EXECUTE CONFIRM ERROR:", err);
    return null;
  }
}

interface PromptFormState {
  label: string;
  content: string;
  shortcut: string;
  icon: string;
  color: QuickPromptColor;
  triggerType: QuickPromptTriggerType;
  keywords: string;
  regex: string;
  agentProfiles: string;
  targetModelId: string;
}

const EMPTY_FORM: PromptFormState = {
  label: "",
  content: "",
  shortcut: "",
  icon: "",
  color: "neutral",
  triggerType: "fixed",
  keywords: "",
  regex: "",
  agentProfiles: "",
  targetModelId: "",
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
  availableModels = [],
  theme,
}: QuickPromptsModalProps) {
  const [activeTab, setActiveTab] = useState<ScopeTab>(projectId ? "project" : "global");
  const [viewMode, setViewMode] = useState<ModalViewMode>("list");
  const [editingItem, setEditingItem] = useState<QuickPromptItem | null>(null);
  const [form, setForm] = useState<PromptFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);
  const toast = useSafeToast();

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
    setConfirmAction(null);
    setViewMode("create");
  }, []);

  const handleOpenEdit = useCallback((item: QuickPromptItem) => {
    setEditingItem(item);
    setForm({
      label: item.label,
      content: item.content,
      shortcut: item.shortcut ?? "",
      icon: item.icon ?? "",
      color: item.color ?? "neutral",
      triggerType: item.triggerType,
      keywords: (item.ruleCondition?.keywords ?? []).join(", "),
      regex: item.ruleCondition?.regex ?? "",
      agentProfiles: (item.ruleCondition?.agentProfiles ?? []).join(", "),
      targetModelId: item.targetModelId ?? "",
    });
    setError(null);
    setConfirmAction(null);
    setViewMode("edit");
  }, []);

  const handleBackToList = useCallback(() => {
    setViewMode("list");
    setEditingItem(null);
    setError(null);
    setConfirmAction(null);
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

  // Confirm action executor (Reset or Delete)
  const handleExecuteConfirm = useCallback(async () => {
    if (!confirmAction) return;
    setIsProcessingAction(true);
    try {
      if (confirmAction.type === "reset") {
        await onResetGlobalDefaults();
        setConfirmAction(null);
        toast?.show("已成功恢复默认快捷提示词 / Reset to defaults successfully", {
          variant: "success",
        });
      } else if (confirmAction.type === "delete") {
        if (confirmAction.scope === "global") {
          const updated = globalItems.filter((item) => item.id !== confirmAction.id);
          await onSaveGlobalItems(updated);
        } else if (onSaveProjectConfig) {
          const updated = projectItems.filter((item) => item.id !== confirmAction.id);
          await onSaveProjectConfig({ items: updated });
        }
        setConfirmAction(null);
        toast?.show(`已删除提示词 "${confirmAction.label}" / Prompt deleted`, {
          variant: "info",
        });
      }
    } catch {
      toast?.error(
        confirmAction.type === "reset"
          ? "重置失败，请重试 / Failed to reset"
          : "删除失败，请重试 / Failed to delete",
      );
    } finally {
      setIsProcessingAction(false);
    }
  }, [
    confirmAction,
    globalItems,
    onResetGlobalDefaults,
    onSaveGlobalItems,
    onSaveProjectConfig,
    projectItems,
    toast,
  ]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmAction(null);
  }, []);

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

  const handleSwitchTab = useCallback((tab: ScopeTab) => {
    setActiveTab(tab);
    setConfirmAction(null);
  }, []);

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
      icon: form.icon.trim() || undefined,
      color: form.color,
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
      targetModelId: form.targetModelId.trim() || undefined,
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

  const previewColorConfig =
    form.color && PROMPT_COLOR_PALETTE[form.color]
      ? PROMPT_COLOR_PALETTE[form.color]
      : PROMPT_COLOR_PALETTE.neutral;
  const previewTextColor = previewColorConfig.text;

  return (
    <Modal
      title="快速提示词 / Quick Prompts"
      open={visible}
      onOpenChange={(open) => {
        if (!open) {
          setConfirmAction(null);
          onClose();
        }
      }}
    >
      <Modal.Content
        style={[styles.container, { backgroundColor: colors.surface0 }]}
        scrollable={viewMode === "list"}
      >
        {/* Scope Tabs */}
        {projectId && viewMode === "list" && (
          <View style={[styles.tabBar, { borderColor: colors.border }]}>
            <Pressable
              onPress={() => handleSwitchTab("project")}
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
              onPress={() => handleSwitchTab("global")}
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
                  onPress={() => setConfirmAction({ type: "reset" })}
                  style={[
                    styles.secondaryButton,
                    { borderColor: colors.border },
                    confirmAction?.type === "reset" && { borderColor: colors.statusDanger },
                  ]}
                >
                  <Text
                    style={[
                      styles.secondaryButtonText,
                      {
                        color:
                          confirmAction?.type === "reset"
                            ? colors.statusDanger
                            : colors.foregroundMuted,
                      },
                    ]}
                  >
                    重置默认 / Reset
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Confirmation Banner / Card */}
            {confirmAction && (
              <View
                style={[
                  styles.confirmCard,
                  {
                    backgroundColor: colors.surface1,
                    borderColor: colors.statusDanger,
                  },
                ]}
              >
                <View style={styles.confirmHeader}>
                  <Text style={[styles.confirmTitle, { color: colors.statusDanger }]}>
                    {confirmAction.type === "reset"
                      ? "⚠️ 确认恢复默认提示词？ / Reset to Defaults?"
                      : `⚠️ 确认删除提示词？ / Delete "${confirmAction.label}"?`}
                  </Text>
                  <Text style={[styles.confirmMessage, { color: colors.foregroundMuted }]}>
                    {confirmAction.type === "reset"
                      ? "此操作将清除所有自定义全局快捷按钮并还原为初始默认配置，修改无法撤销。"
                      : `确定要删除快捷提示词 “${confirmAction.label}” 吗？此操作不可撤销。`}
                  </Text>
                </View>
                <View style={styles.confirmActionRow}>
                  <Pressable
                    onPress={handleCancelConfirm}
                    disabled={isProcessingAction}
                    style={[styles.secondaryButton, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>
                      取消 / Cancel
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={handleExecuteConfirm}
                    disabled={isProcessingAction}
                    style={[styles.dangerButton, { backgroundColor: colors.statusDanger }]}
                  >
                    <Text style={styles.dangerButtonText}>
                      {isProcessingAction
                        ? confirmAction.type === "reset"
                          ? "重置中... / Resetting..."
                          : "删除中... / Deleting..."
                        : confirmAction.type === "reset"
                          ? "确认重置 / Yes, Reset"
                          : "确认删除 / Delete"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {/* List items */}
            {activeTab === "global" ? (
              globalItems.map((item, idx) => {
                const itemColorCfg = item.color ? PROMPT_COLOR_PALETTE[item.color] : null;
                return (
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
                        {item.icon && (
                          <Icon
                            name={item.icon}
                            size={14}
                            color={itemColorCfg ? itemColorCfg.text : colors.foreground}
                          />
                        )}
                        <Text style={[styles.itemLabel, { color: colors.foreground }]}>
                          {item.label}
                        </Text>
                        {itemColorCfg && itemColorCfg.dotColor !== "#9ca3af" && (
                          <View
                            style={[
                              styles.badgePill,
                              {
                                backgroundColor: itemColorCfg.tint,
                                borderColor: itemColorCfg.border,
                              },
                            ]}
                          >
                            <Text style={[styles.badgePillText, { color: itemColorCfg.text }]}>
                              {itemColorCfg.label}
                            </Text>
                          </View>
                        )}
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
                            color:
                              idx === globalItems.length - 1 ? colors.border : colors.foreground,
                          }}
                        >
                          ↓
                        </Text>
                      </Pressable>
                      <Pressable onPress={() => handleOpenEdit(item)} style={styles.iconBtn}>
                        <Text style={{ color: colors.accent }}>✏️</Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setConfirmAction({
                            type: "delete",
                            id: item.id,
                            label: item.label,
                            scope: "global",
                          })
                        }
                        style={styles.iconBtn}
                      >
                        <Text style={{ color: colors.statusDanger }}>🗑️</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            ) : (
              // Project Items + Inherited Globals
              <>
                {projectItems.map((item) => {
                  const itemColorCfg = item.color ? PROMPT_COLOR_PALETTE[item.color] : null;
                  return (
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
                          {item.icon && (
                            <Icon
                              name={item.icon}
                              size={14}
                              color={itemColorCfg ? itemColorCfg.text : colors.foreground}
                            />
                          )}
                          <Text style={[styles.itemLabel, { color: colors.foreground }]}>
                            {item.label}
                          </Text>
                          {itemColorCfg && itemColorCfg.dotColor !== "#9ca3af" && (
                            <View
                              style={[
                                styles.badgePill,
                                {
                                  backgroundColor: itemColorCfg.tint,
                                  borderColor: itemColorCfg.border,
                                },
                              ]}
                            >
                              <Text style={[styles.badgePillText, { color: itemColorCfg.text }]}>
                                {itemColorCfg.label}
                              </Text>
                            </View>
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
                        <Pressable onPress={() => handleOpenEdit(item)} style={styles.iconBtn}>
                          <Text style={{ color: colors.accent }}>✏️</Text>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            setConfirmAction({
                              type: "delete",
                              id: item.id,
                              label: item.label,
                              scope: "project",
                            })
                          }
                          style={styles.iconBtn}
                        >
                          <Text style={{ color: colors.statusDanger }}>🗑️</Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}

                {/* Inherited globals list */}
                {globalItems.map((item) => {
                  const isDisabledInProject = disabledGlobalIds.includes(item.id);
                  const itemColorCfg = item.color ? PROMPT_COLOR_PALETTE[item.color] : null;
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
                          {item.icon && (
                            <Icon
                              name={item.icon}
                              size={14}
                              color={itemColorCfg ? itemColorCfg.text : colors.foreground}
                            />
                          )}
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

            {/* Color Palette Selector */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 12 }]}>
              按钮色彩 / Color (高亮醒目定制)
            </Text>
            <View style={styles.colorPaletteRow}>
              {(Object.keys(PROMPT_COLOR_PALETTE) as QuickPromptColor[]).map((cKey) => {
                const isSelected = form.color === cKey;
                const cfg = PROMPT_COLOR_PALETTE[cKey];
                return (
                  <Pressable
                    key={cKey}
                    testID={`color-option-${cKey}`}
                    accessibilityRole="button"
                    accessibilityLabel={cfg.label}
                    onPress={() => setForm((prev) => ({ ...prev, color: cKey }))}
                    style={[
                      styles.colorDotButton,
                      {
                        backgroundColor: cfg.tint !== "transparent" ? cfg.tint : colors.surface2,
                        borderColor: isSelected ? cfg.border : colors.border,
                        borderWidth: isSelected ? 2 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.colorDot, { backgroundColor: cfg.dotColor }]} />
                    <Text
                      style={[
                        styles.colorDotLabel,
                        { color: isSelected ? colors.foreground : colors.foregroundMuted },
                      ]}
                    >
                      {cfg.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Icon Picker */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 12 }]}>
              按钮图标 / Icon
            </Text>
            <View style={styles.iconSelectionGrid}>
              <Pressable
                testID="icon-quick-chip-none"
                accessibilityRole="button"
                accessibilityLabel="无图标"
                onPress={() => setForm((prev) => ({ ...prev, icon: "" }))}
                style={[
                  styles.iconQuickChip,
                  !form.icon && { borderColor: colors.accent, backgroundColor: colors.surface2 },
                ]}
              >
                <Text
                  style={[
                    styles.iconQuickChipText,
                    { color: !form.icon ? colors.accent : colors.foregroundMuted },
                  ]}
                >
                  无
                </Text>
              </Pressable>
              {COMMON_PROMPT_ICONS.map((ic) => {
                const isSelected = form.icon === ic.name;
                return (
                  <Pressable
                    key={ic.name}
                    testID={`icon-quick-chip-${ic.name}`}
                    accessibilityRole="button"
                    accessibilityLabel={ic.label}
                    onPress={() => setForm((prev) => ({ ...prev, icon: ic.name }))}
                    style={[
                      styles.iconQuickChip,
                      isSelected && {
                        borderColor: colors.accent,
                        backgroundColor: colors.surface2,
                      },
                    ]}
                  >
                    <Icon
                      name={ic.name}
                      size={13}
                      color={isSelected ? colors.accent : colors.foreground}
                    />
                    <Text
                      style={[
                        styles.iconQuickChipText,
                        { color: isSelected ? colors.accent : colors.foreground },
                      ]}
                    >
                      {ic.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={[
                styles.textInput,
                {
                  backgroundColor: colors.surface1,
                  borderColor: colors.border,
                  color: colors.foreground,
                  marginTop: 6,
                },
              ]}
              value={form.icon}
              onChangeText={(text) => setForm((prev) => ({ ...prev, icon: text.trim() }))}
              placeholder="或输入任意 Lucide 图标名 (例如: Flame, Cpu, Shield...)"
            />

            {/* Live Preview Card */}
            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 14 }]}>
              实时效果预览 / Live Preview
            </Text>
            <View
              style={[
                styles.previewContainer,
                { backgroundColor: colors.surface1, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.previewCard,
                  previewColorConfig && previewColorConfig.tint !== "transparent"
                    ? {
                        backgroundColor: previewColorConfig.tint,
                        borderColor: previewColorConfig.border,
                      }
                    : {
                        backgroundColor: colors.surface2,
                        borderColor: colors.border,
                      },
                ]}
              >
                <View style={styles.previewLabelRow}>
                  {form.icon ? <Icon name={form.icon} size={13} color={previewTextColor} /> : null}
                  <Text
                    style={[styles.previewCardText, { color: previewTextColor }]}
                    numberOfLines={1}
                  >
                    {form.label.trim() || "按钮名称"}
                  </Text>
                </View>
                {form.shortcut ? (
                  <Text style={[styles.previewShortcutTag, { color: previewTextColor }]}>
                    /{form.shortcut.trim()}
                  </Text>
                ) : null}
              </View>
            </View>

            <Text style={[styles.fieldLabel, { color: colors.foreground, marginTop: 12 }]}>
              执行模型 / Model (可选)
            </Text>
            {availableModels.length > 0 ? (
              <View style={[styles.modelSelectBox, { borderColor: colors.border }]}>
                {[
                  { id: "", label: "使用当前模型 / Use current model" },
                  ...availableModels.map((m) => ({ id: m.id, label: m.label })),
                ].map((option) => {
                  const isActive = form.targetModelId === option.id;
                  return (
                    <Pressable
                      key={option.id || "__current__"}
                      onPress={() => setForm((prev) => ({ ...prev, targetModelId: option.id }))}
                      style={[
                        styles.modelOption,
                        isActive && {
                          backgroundColor: colors.surface2,
                          borderColor: colors.accent,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.modelOptionText,
                          { color: isActive ? colors.accent : colors.foreground },
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <Text style={[styles.modelUnavailable, { color: colors.foregroundMuted }]}>
                暂无可用模型列表，将使用当前模型 / No models available, will use current model
              </Text>
            )}

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
  confirmCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    marginBottom: 10,
    gap: 10,
  },
  confirmHeader: {
    gap: 4,
  },
  confirmTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  confirmMessage: {
    fontSize: 12,
    lineHeight: 16,
  },
  confirmActionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 8,
  },
  dangerButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
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
  badgePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  badgePillText: {
    fontSize: 10,
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
    gap: 8,
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
    minHeight: 70,
    textAlignVertical: "top",
  },
  colorPaletteRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  colorDotButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  colorDotLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  iconSelectionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
  },
  iconQuickChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#404040",
  },
  iconQuickChipText: {
    fontSize: 11,
    fontWeight: "500",
  },
  previewContainer: {
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  previewCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: 160,
    height: 32,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
  },
  previewLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    flexShrink: 1,
  },
  previewCardText: {
    fontSize: 12,
    fontWeight: "600",
  },
  previewShortcutTag: {
    fontSize: 10,
    fontWeight: "500",
    opacity: 0.8,
  },
  errorText: {
    fontSize: 12,
    marginBottom: 6,
  },
  modelSelectBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    borderWidth: 1,
    borderRadius: 6,
    padding: 8,
  },
  modelOption: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  modelOptionText: {
    fontSize: 13,
  },
  modelUnavailable: {
    fontSize: 12,
    lineHeight: 16,
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
