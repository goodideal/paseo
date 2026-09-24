import React, { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  FolderGit2,
  Globe,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useSessionStore } from "@/stores/session-store";
import { useGlobalQuickPrompts, useProjectQuickPrompts } from "@/hooks/use-quick-prompts";
import {
  type QuickPromptItem,
  type QuickPromptTriggerType,
} from "@getpaseo/protocol/quick-prompts";
import { generateMessageId } from "@/types/stream";

export interface QuickPromptsModalProps {
  visible: boolean;
  onClose: () => void;
  serverId?: string | null;
  workspaceId?: string | null;
  initialTab?: "project" | "global";
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

function ScopeBadge({
  isProjectScopedItem,
  isInheritedGlobal,
}: {
  isProjectScopedItem?: boolean;
  isInheritedGlobal?: boolean;
}) {
  const { t } = useTranslation();
  if (isProjectScopedItem) {
    return (
      <View style={styles.badgeProject}>
        <FolderGit2 size={10} color={styles.badgeProjectText.color} />
        <Text style={styles.badgeProjectText}>{t("composer.quickPrompts.modal.projectScope")}</Text>
      </View>
    );
  }
  if (isInheritedGlobal) {
    return (
      <View style={styles.badgeGlobal}>
        <Globe size={10} color={styles.badgeGlobalText.color} />
        <Text style={styles.badgeGlobalText}>{t("composer.quickPrompts.modal.globalScope")}</Text>
      </View>
    );
  }
  return null;
}

interface QuickPromptCardProps {
  item: QuickPromptItem;
  isProjectScopedItem?: boolean;
  isInheritedGlobal?: boolean;
  isDisabledInProject?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  onToggle: (id: string) => void;
  onEdit?: (item: QuickPromptItem) => void;
  onDelete?: (id: string) => void;
  onMoveUp?: (id: string) => void;
  onMoveDown?: (id: string) => void;
  onJumpToGlobal?: (item: QuickPromptItem) => void;
}

const QuickPromptCard = memo(function QuickPromptCard({
  item,
  isProjectScopedItem,
  isInheritedGlobal,
  isDisabledInProject,
  isFirst,
  isLast,
  onToggle,
  onEdit,
  onDelete,
  onMoveUp,
  onMoveDown,
  onJumpToGlobal,
}: QuickPromptCardProps) {
  const { t } = useTranslation();
  const handleToggle = useCallback(() => onToggle(item.id), [item.id, onToggle]);
  const handleEdit = useCallback(() => onEdit?.(item), [item, onEdit]);
  const handleDelete = useCallback(() => onDelete?.(item.id), [item.id, onDelete]);
  const handleMoveUp = useCallback(() => onMoveUp?.(item.id), [item.id, onMoveUp]);
  const handleMoveDown = useCallback(() => onMoveDown?.(item.id), [item.id, onMoveDown]);
  const handleJump = useCallback(() => onJumpToGlobal?.(item), [item, onJumpToGlobal]);

  const isRule = item.triggerType === "rule";
  const switchValue = isInheritedGlobal ? !isDisabledInProject : item.enabled;

  return (
    <View style={styles.itemCard} testID={`quick-prompt-item-${item.id}`}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Switch
            value={switchValue}
            onValueChange={handleToggle}
            testID={`quick-prompt-toggle-${item.id}`}
          />
          <Text style={styles.itemLabel}>{item.label}</Text>

          <ScopeBadge
            isProjectScopedItem={isProjectScopedItem}
            isInheritedGlobal={isInheritedGlobal}
          />

          {item.shortcut ? (
            <View style={styles.badgeShortcut}>
              <Text style={styles.badgeShortcutText}>/{item.shortcut}</Text>
            </View>
          ) : null}

          <View style={[styles.badgeTrigger, isRule && styles.badgeTriggerRule]}>
            {isRule ? <Sparkles size={10} color={styles.ruleIcon.color} /> : null}
            <Text style={[styles.badgeTriggerText, isRule && styles.badgeTriggerTextRule]}>
              {item.triggerType === "fixed"
                ? t("composer.quickPrompts.modal.fixedBadge")
                : t("composer.quickPrompts.modal.ruleBadge")}
            </Text>
          </View>
        </View>

        <View style={styles.itemActions}>
          {isInheritedGlobal ? (
            <Pressable
              onPress={handleJump}
              style={styles.actionJumpBtn}
              accessibilityLabel={t("composer.quickPrompts.modal.jumpToGlobal")}
              testID={`quick-prompt-jump-${item.id}`}
            >
              <Text style={styles.actionJumpText}>
                {t("composer.quickPrompts.modal.jumpToGlobal")}
              </Text>
              <ExternalLink size={12} color={styles.actionJumpText.color} />
            </Pressable>
          ) : (
            <>
              {onMoveUp ? (
                <Pressable
                  onPress={handleMoveUp}
                  disabled={isFirst}
                  style={[styles.actionIconBtn, isFirst && styles.actionIconDisabled]}
                  accessibilityLabel={t("composer.quickPrompts.modal.moveUp")}
                  testID={`quick-prompt-move-up-${item.id}`}
                >
                  <ArrowUp
                    size={14}
                    color={isFirst ? styles.actionIconDisabledText.color : styles.actionIcon.color}
                  />
                </Pressable>
              ) : null}
              {onMoveDown ? (
                <Pressable
                  onPress={handleMoveDown}
                  disabled={isLast}
                  style={[styles.actionIconBtn, isLast && styles.actionIconDisabled]}
                  accessibilityLabel={t("composer.quickPrompts.modal.moveDown")}
                  testID={`quick-prompt-move-down-${item.id}`}
                >
                  <ArrowDown
                    size={14}
                    color={isLast ? styles.actionIconDisabledText.color : styles.actionIcon.color}
                  />
                </Pressable>
              ) : null}
              {onEdit ? (
                <Pressable
                  onPress={handleEdit}
                  style={styles.actionIconBtn}
                  accessibilityLabel={t("composer.quickPrompts.modal.edit")}
                  testID={`quick-prompt-edit-${item.id}`}
                >
                  <Pencil size={14} color={styles.actionIcon.color} />
                </Pressable>
              ) : null}
              {onDelete ? (
                <Pressable
                  onPress={handleDelete}
                  style={styles.actionIconBtn}
                  accessibilityLabel={t("composer.quickPrompts.modal.delete")}
                  testID={`quick-prompt-delete-${item.id}`}
                >
                  <Trash2 size={14} color={styles.dangerIcon.color} />
                </Pressable>
              ) : null}
            </>
          )}
        </View>
      </View>

      <Text style={styles.itemContentPreview} numberOfLines={2}>
        {item.content}
      </Text>
    </View>
  );
});

function resolveFormTitle(
  mode: "create" | "edit",
  scope: ScopeTab,
  t: (key: string) => string,
): string {
  if (mode === "create") {
    return scope === "project"
      ? t("composer.quickPrompts.modal.newProjectPrompt")
      : t("composer.quickPrompts.modal.newGlobalPrompt");
  }
  return scope === "project"
    ? t("composer.quickPrompts.modal.editProjectPrompt")
    : t("composer.quickPrompts.modal.editGlobalPrompt");
}

export function QuickPromptsModal({
  visible,
  onClose,
  serverId: propServerId,
  workspaceId,
  initialTab,
}: QuickPromptsModalProps) {
  const { t } = useTranslation();

  const resolvedServerId = useSessionStore((state) => {
    if (propServerId) return propServerId;
    for (const key in state.sessions) {
      if (Object.prototype.hasOwnProperty.call(state.sessions, key)) return key;
    }
    return "";
  });

  const projectId = useSessionStore((state) => {
    if (!resolvedServerId || !workspaceId) return null;
    return state.sessions[resolvedServerId]?.workspaces?.get(workspaceId)?.projectId ?? null;
  });

  const hasProjectScope = Boolean(projectId);
  const [activeTab, setActiveTab] = useState<ScopeTab>(
    initialTab ?? (hasProjectScope ? "project" : "global"),
  );

  const globalStore = useGlobalQuickPrompts(resolvedServerId);
  const projectStore = useProjectQuickPrompts(resolvedServerId, projectId);

  const [mode, setMode] = useState<ModalViewMode>("list");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTargetScope, setEditingTargetScope] = useState<ScopeTab>("global");
  const [form, setForm] = useState<PromptFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const triggerTypeOptions = useMemo(
    () => [
      {
        value: "fixed" as const,
        label: t("composer.quickPrompts.modal.form.triggerFixed"),
      },
      {
        value: "rule" as const,
        label: t("composer.quickPrompts.modal.form.triggerRule"),
      },
    ],
    [t],
  );

  const scopeTabs = useMemo(
    () => [
      {
        value: "project" as const,
        label: t("composer.quickPrompts.modal.tabProject"),
      },
      {
        value: "global" as const,
        label: t("composer.quickPrompts.modal.tabGlobal"),
      },
    ],
    [t],
  );

  const handleClose = useCallback(() => {
    setMode("list");
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setError(null);
    onClose();
  }, [onClose]);

  const handleStartCreate = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingItemId(null);
    setEditingTargetScope(activeTab);
    setError(null);
    setMode("create");
  }, [activeTab]);

  const handleStartEdit = useCallback((item: QuickPromptItem, targetScope: ScopeTab) => {
    setEditingItemId(item.id);
    setEditingTargetScope(targetScope);
    setForm({
      label: item.label,
      content: item.content,
      shortcut: item.shortcut ?? "",
      triggerType: item.triggerType,
      keywords: item.ruleCondition?.keywords?.join(", ") ?? "",
      regex: item.ruleCondition?.regex ?? "",
      agentProfiles: item.ruleCondition?.agentProfiles?.join(", ") ?? "",
    });
    setError(null);
    setMode("edit");
  }, []);

  const handleEditProjectItem = useCallback(
    (item: QuickPromptItem) => handleStartEdit(item, "project"),
    [handleStartEdit],
  );

  const handleEditGlobalItem = useCallback(
    (item: QuickPromptItem) => handleStartEdit(item, "global"),
    [handleStartEdit],
  );

  const handleJumpToGlobalAndEdit = useCallback(
    (item: QuickPromptItem) => {
      setActiveTab("global");
      handleStartEdit(item, "global");
    },
    [handleStartEdit],
  );

  const handleCancelEdit = useCallback(() => {
    setMode("list");
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, []);

  const handleToggleGlobalItem = useCallback(
    (id: string) => {
      const updated = globalStore.items.map((i) =>
        i.id === id ? { ...i, enabled: !i.enabled } : i,
      );
      void globalStore.setGlobalItems(updated);
    },
    [globalStore],
  );

  const handleToggleProjectItem = useCallback(
    (id: string) => {
      const updated = projectStore.items.map((i) =>
        i.id === id ? { ...i, enabled: !i.enabled } : i,
      );
      void projectStore.setProjectConfig({
        items: updated,
        disabledGlobalIds: projectStore.disabledGlobalIds,
        order: projectStore.order,
      });
    },
    [projectStore],
  );

  const handleToggleInheritedGlobalInProject = useCallback(
    (id: string) => {
      const isCurrentlyDisabled = projectStore.disabledGlobalIds.includes(id);
      const nextDisabled = isCurrentlyDisabled
        ? projectStore.disabledGlobalIds.filter((d) => d !== id)
        : [...projectStore.disabledGlobalIds, id];

      void projectStore.setProjectConfig({
        items: projectStore.items,
        disabledGlobalIds: nextDisabled,
        order: projectStore.order,
      });
    },
    [projectStore],
  );

  const handleDeleteGlobalItem = useCallback(
    (id: string) => {
      const updated = globalStore.items.filter((i) => i.id !== id);
      void globalStore.setGlobalItems(updated);
    },
    [globalStore],
  );

  const handleDeleteProjectItem = useCallback(
    (id: string) => {
      const updated = projectStore.items.filter((i) => i.id !== id);
      void projectStore.setProjectConfig({
        items: updated,
        disabledGlobalIds: projectStore.disabledGlobalIds,
        order: projectStore.order,
      });
    },
    [projectStore],
  );

  const handleSave = useCallback(() => {
    if (!form.label.trim()) {
      setError(t("composer.quickPrompts.modal.form.errorLabelRequired"));
      return;
    }
    if (!form.content.trim()) {
      setError(t("composer.quickPrompts.modal.form.errorContentRequired"));
      return;
    }

    const keywords =
      form.triggerType === "rule" && form.keywords.trim()
        ? form.keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : undefined;

    const agentProfiles =
      form.triggerType === "rule" && form.agentProfiles.trim()
        ? form.agentProfiles
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : undefined;

    const regex = form.triggerType === "rule" && form.regex.trim() ? form.regex.trim() : undefined;

    const ruleCondition =
      keywords || regex || agentProfiles
        ? {
            keywords,
            regex,
            agentProfiles,
          }
        : undefined;

    const shortcut = form.shortcut.trim().replace(/^\//, "") || undefined;

    if (editingTargetScope === "project") {
      if (mode === "create") {
        const newItem: QuickPromptItem = {
          id: `qp_prj_${generateMessageId()}`,
          label: form.label.trim(),
          content: form.content.trim(),
          shortcut,
          triggerType: form.triggerType,
          ruleCondition,
          enabled: true,
          createdAt: Date.now(),
          order: projectStore.items.length,
        };
        void projectStore.setProjectConfig({
          items: [...projectStore.items, newItem],
          disabledGlobalIds: projectStore.disabledGlobalIds,
          order: projectStore.order,
        });
      } else if (editingItemId) {
        const updated = projectStore.items.map((item) =>
          item.id === editingItemId
            ? {
                ...item,
                label: form.label.trim(),
                content: form.content.trim(),
                shortcut,
                triggerType: form.triggerType,
                ruleCondition,
              }
            : item,
        );
        void projectStore.setProjectConfig({
          items: updated,
          disabledGlobalIds: projectStore.disabledGlobalIds,
          order: projectStore.order,
        });
      }
    } else {
      if (mode === "create") {
        const newItem: QuickPromptItem = {
          id: `qp_glb_${generateMessageId()}`,
          label: form.label.trim(),
          content: form.content.trim(),
          shortcut,
          triggerType: form.triggerType,
          ruleCondition,
          enabled: true,
          createdAt: Date.now(),
          order: globalStore.items.length,
        };
        void globalStore.setGlobalItems([...globalStore.items, newItem]);
      } else if (editingItemId) {
        const updated = globalStore.items.map((item) =>
          item.id === editingItemId
            ? {
                ...item,
                label: form.label.trim(),
                content: form.content.trim(),
                shortcut,
                triggerType: form.triggerType,
                ruleCondition,
              }
            : item,
        );
        void globalStore.setGlobalItems(updated);
      }
    }

    setMode("list");
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, [form, editingTargetScope, mode, editingItemId, t, projectStore, globalStore]);

  const handleLabelChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, label: text }));
    setError(null);
  }, []);

  const handleContentChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, content: text }));
    setError(null);
  }, []);

  const handleShortcutChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, shortcut: text }));
  }, []);

  const handleTriggerTypeChange = useCallback((value: QuickPromptTriggerType) => {
    setForm((f) => ({ ...f, triggerType: value }));
  }, []);

  const handleAgentProfilesChange = useCallback((text: string) => {
    setForm((prev) => ({ ...prev, agentProfiles: text }));
  }, []);

  const handleKeywordsChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, keywords: text }));
  }, []);

  const handleRegexChange = useCallback((text: string) => {
    setForm((f) => ({ ...f, regex: text }));
  }, []);

  const formTitle = useMemo(
    () => resolveFormTitle(mode === "create" ? "create" : "edit", editingTargetScope, t),
    [mode, editingTargetScope, t],
  );

  const sortedProjectItems = useMemo(() => {
    const list = [...projectStore.items];
    if (projectStore.order && projectStore.order.length > 0) {
      const orderMap = new Map(projectStore.order.map((id, index) => [id, index]));
      list.sort((a, b) => {
        const idxA = orderMap.get(a.id) ?? a.order ?? 0;
        const idxB = orderMap.get(b.id) ?? b.order ?? 0;
        return idxA - idxB;
      });
    } else {
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
    return list;
  }, [projectStore.items, projectStore.order]);

  const sortedGlobalItems = useMemo(() => {
    return [...globalStore.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [globalStore.items]);

  const handleMoveUpProjectItem = useCallback(
    (id: string) => {
      const index = sortedProjectItems.findIndex((i) => i.id === id);
      if (index <= 0) return;
      const next = [...sortedProjectItems];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      const updated = next.map((item, idx) => Object.assign({}, item, { order: idx }));
      void projectStore.setProjectConfig({
        items: updated,
        disabledGlobalIds: projectStore.disabledGlobalIds,
        order: updated.map((i) => i.id),
      });
    },
    [sortedProjectItems, projectStore],
  );

  const handleMoveDownProjectItem = useCallback(
    (id: string) => {
      const index = sortedProjectItems.findIndex((i) => i.id === id);
      if (index === -1 || index >= sortedProjectItems.length - 1) return;
      const next = [...sortedProjectItems];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      const updated = next.map((item, idx) => Object.assign({}, item, { order: idx }));
      void projectStore.setProjectConfig({
        items: updated,
        disabledGlobalIds: projectStore.disabledGlobalIds,
        order: updated.map((i) => i.id),
      });
    },
    [sortedProjectItems, projectStore],
  );

  const handleMoveUpGlobalItem = useCallback(
    (id: string) => {
      const index = sortedGlobalItems.findIndex((i) => i.id === id);
      if (index <= 0) return;
      const next = [...sortedGlobalItems];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      const updated = next.map((item, idx) => Object.assign({}, item, { order: idx }));
      void globalStore.setGlobalItems(updated);
    },
    [sortedGlobalItems, globalStore],
  );

  const handleMoveDownGlobalItem = useCallback(
    (id: string) => {
      const index = sortedGlobalItems.findIndex((i) => i.id === id);
      if (index === -1 || index >= sortedGlobalItems.length - 1) return;
      const next = [...sortedGlobalItems];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      const updated = next.map((item, idx) => Object.assign({}, item, { order: idx }));
      void globalStore.setGlobalItems(updated);
    },
    [sortedGlobalItems, globalStore],
  );

  const modalHeader = useMemo(() => ({ title: t("composer.quickPrompts.modal.title") }), [t]);

  return (
    <AdaptiveModalSheet visible={visible} onClose={handleClose} header={modalHeader}>
      <View style={styles.container}>
        {mode === "list" ? (
          <View style={styles.listContainer}>
            {hasProjectScope ? (
              <View style={styles.tabBarWrapper}>
                <SegmentedControl
                  value={activeTab}
                  onValueChange={setActiveTab}
                  options={scopeTabs}
                />
              </View>
            ) : null}

            <View style={styles.topActions}>
              <View style={styles.scopeNoticeBox}>
                <Text style={styles.scopeNoticeText}>
                  {activeTab === "project"
                    ? t("composer.quickPrompts.modal.projectNotice")
                    : t("composer.quickPrompts.modal.globalNotice")}
                </Text>
              </View>

              <View style={styles.actionButtonsRow}>
                {activeTab === "global" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={globalStore.resetToDefaults}
                    testID="quick-prompt-reset-button"
                  >
                    <RotateCcw size={14} color={styles.outlineIcon.color} />
                    <Text style={styles.buttonText}>
                      {t("composer.quickPrompts.modal.resetToDefaults")}
                    </Text>
                  </Button>
                ) : null}

                <Button
                  variant="default"
                  size="sm"
                  onPress={handleStartCreate}
                  testID="quick-prompt-create-button"
                >
                  <Plus size={14} color="white" />
                  <Text style={styles.buttonTextWhite}>
                    {activeTab === "project"
                      ? t("composer.quickPrompts.modal.newProjectPrompt")
                      : t("composer.quickPrompts.modal.newGlobalPrompt")}
                  </Text>
                </Button>
              </View>
            </View>

            <ScrollView
              style={styles.itemList}
              contentContainerStyle={styles.scrollInner}
              showsVerticalScrollIndicator
            >
              {activeTab === "project" ? (
                <>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>
                      {t("composer.quickPrompts.modal.projectScope")} ({projectStore.items.length})
                    </Text>
                  </View>

                  {sortedProjectItems.length === 0 ? (
                    <View style={styles.emptyCard}>
                      <Text style={styles.emptyText}>
                        {t("composer.quickPrompts.modal.emptyProjectItems")}
                      </Text>
                    </View>
                  ) : (
                    sortedProjectItems.map((item, index) => (
                      <QuickPromptCard
                        key={item.id}
                        item={item}
                        isProjectScopedItem
                        isFirst={index === 0}
                        isLast={index === sortedProjectItems.length - 1}
                        onToggle={handleToggleProjectItem}
                        onEdit={handleEditProjectItem}
                        onDelete={handleDeleteProjectItem}
                        onMoveUp={handleMoveUpProjectItem}
                        onMoveDown={handleMoveDownProjectItem}
                      />
                    ))
                  )}

                  <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                    <Text style={styles.sectionTitle}>
                      {t("composer.quickPrompts.modal.globalScope")} ({globalStore.items.length})
                    </Text>
                    <Text style={styles.sectionSubtitle}>
                      {t("composer.quickPrompts.modal.globalReadOnlyHint")}
                    </Text>
                  </View>

                  {sortedGlobalItems.map((item) => (
                    <QuickPromptCard
                      key={item.id}
                      item={item}
                      isInheritedGlobal
                      isDisabledInProject={projectStore.disabledGlobalIds.includes(item.id)}
                      onToggle={handleToggleInheritedGlobalInProject}
                      onJumpToGlobal={handleJumpToGlobalAndEdit}
                    />
                  ))}
                </>
              ) : (
                sortedGlobalItems.map((item, index) => (
                  <QuickPromptCard
                    key={item.id}
                    item={item}
                    isFirst={index === 0}
                    isLast={index === sortedGlobalItems.length - 1}
                    onToggle={handleToggleGlobalItem}
                    onEdit={handleEditGlobalItem}
                    onDelete={handleDeleteGlobalItem}
                    onMoveUp={handleMoveUpGlobalItem}
                    onMoveDown={handleMoveDownGlobalItem}
                  />
                ))
              )}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.formContainer} keyboardShouldPersistTaps="handled">
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>{formTitle}</Text>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t("composer.quickPrompts.modal.form.label")}</Text>
              <AdaptiveTextInput
                initialValue={form.label}
                onChangeText={handleLabelChange}
                placeholder={t("composer.quickPrompts.modal.form.labelPlaceholder")}
                style={styles.textInput}
                testID="quick-prompt-form-label"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>{t("composer.quickPrompts.modal.form.content")}</Text>
              <AdaptiveTextInput
                initialValue={form.content}
                onChangeText={handleContentChange}
                placeholder={t("composer.quickPrompts.modal.form.contentPlaceholder")}
                multiline
                numberOfLines={3}
                style={[styles.textInput, styles.textAreaInput]}
                testID="quick-prompt-form-content"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>
                {t("composer.quickPrompts.modal.form.shortcut")}
              </Text>
              <AdaptiveTextInput
                initialValue={form.shortcut}
                onChangeText={handleShortcutChange}
                placeholder={t("composer.quickPrompts.modal.form.shortcutPlaceholder")}
                autoCapitalize="none"
                style={styles.textInput}
                testID="quick-prompt-form-shortcut"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>
                {t("composer.quickPrompts.modal.form.triggerType")}
              </Text>
              <SegmentedControl
                value={form.triggerType}
                onValueChange={handleTriggerTypeChange}
                options={triggerTypeOptions}
                testID="quick-prompt-form-trigger"
              />
            </View>

            {form.triggerType === "rule" ? (
              <View style={styles.ruleBox}>
                <View style={styles.formField}>
                  <Text style={styles.fieldLabel}>
                    {t("composer.quickPrompts.modal.form.agentProfiles")}
                  </Text>
                  <AdaptiveTextInput
                    initialValue={form.agentProfiles}
                    onChangeText={handleAgentProfilesChange}
                    placeholder={t("composer.quickPrompts.modal.form.agentProfilesPlaceholder")}
                    style={styles.textInput}
                    testID="quick-prompt-form-agent-profiles"
                  />
                </View>
                <View style={styles.formField}>
                  <Text style={styles.fieldLabel}>
                    {t("composer.quickPrompts.modal.form.keywords")}
                  </Text>
                  <AdaptiveTextInput
                    initialValue={form.keywords}
                    onChangeText={handleKeywordsChange}
                    placeholder={t("composer.quickPrompts.modal.form.keywordsPlaceholder")}
                    style={styles.textInput}
                    testID="quick-prompt-form-keywords"
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.fieldLabel}>
                    {t("composer.quickPrompts.modal.form.regex")}
                  </Text>
                  <AdaptiveTextInput
                    initialValue={form.regex}
                    onChangeText={handleRegexChange}
                    placeholder={t("composer.quickPrompts.modal.form.regexPlaceholder")}
                    autoCapitalize="none"
                    style={styles.textInput}
                    testID="quick-prompt-form-regex"
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.formActions}>
              <Button variant="secondary" size="sm" onPress={handleCancelEdit}>
                {t("composer.quickPrompts.modal.form.cancel")}
              </Button>
              <Button
                variant="default"
                size="sm"
                onPress={handleSave}
                testID="quick-prompt-form-save"
              >
                {t("composer.quickPrompts.modal.form.save")}
              </Button>
            </View>
          </ScrollView>
        )}
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    maxHeight: 560,
    paddingBottom: theme.spacing[2],
  },
  listContainer: {
    gap: 10,
  },
  tabBarWrapper: {
    marginBottom: theme.spacing[1],
  },
  topActions: {
    flexDirection: "column",
    gap: theme.spacing[2],
  },
  scopeNoticeBox: {
    backgroundColor: theme.colors.surface1,
    paddingHorizontal: 10,
    paddingVertical: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: theme.colors.accent,
  },
  scopeNoticeText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 16,
  },
  actionButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
  },
  buttonTextWhite: {
    color: "white",
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    marginLeft: theme.spacing[1],
  },
  buttonText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    marginLeft: theme.spacing[1],
  },
  outlineIcon: {
    color: theme.colors.foregroundMuted,
  },
  itemList: {
    maxHeight: 400,
  },
  scrollInner: {
    paddingBottom: theme.spacing[3],
  },
  sectionHeader: {
    marginTop: theme.spacing[1],
    marginBottom: theme.spacing[1.5],
    gap: 2,
  },
  sectionHeaderSpaced: {
    marginTop: theme.spacing[3],
    paddingTop: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: theme.fontSize.sm,
    fontWeight: "700",
    color: theme.colors.foregroundMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionSubtitle: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
  emptyCard: {
    padding: theme.spacing[3],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.spacing[2],
  },
  emptyText: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
  itemCard: {
    backgroundColor: theme.colors.surface2,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    gap: theme.spacing[1.5],
  },
  itemHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  itemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flex: 1,
    flexWrap: "wrap",
  },
  itemLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  badgeProject: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
  },
  badgeProjectText: {
    fontSize: 10,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  badgeGlobal: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  badgeGlobalText: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
  },
  badgeShortcut: {
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  badgeShortcutText: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
  },
  badgeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  badgeTriggerRule: {
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
  },
  badgeTriggerText: {
    fontSize: 10,
    color: theme.colors.foregroundMuted,
  },
  badgeTriggerTextRule: {
    color: theme.colors.accent,
  },
  ruleIcon: {
    color: theme.colors.accent,
  },
  itemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  actionJumpBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 4,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.surface3,
  },
  actionJumpText: {
    fontSize: 11,
    color: theme.colors.accent,
  },
  actionIconBtn: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  actionIcon: {
    color: theme.colors.foregroundMuted,
  },
  actionIconDisabled: {
    opacity: 0.35,
  },
  actionIconDisabledText: {
    color: theme.colors.foregroundMuted,
  },
  dangerIcon: {
    color: theme.colors.destructive ?? "#f87171",
  },
  itemContentPreview: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 18,
  },
  formContainer: {
    maxHeight: 480,
  },
  formHeader: {
    marginBottom: 10,
  },
  formTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  formField: {
    marginBottom: theme.spacing[3],
    gap: theme.spacing[1],
  },
  fieldLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  textInput: {
    backgroundColor: theme.colors.surface0,
    color: theme.colors.foreground,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: 10,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    fontSize: theme.fontSize.sm,
  },
  textAreaInput: {
    minHeight: 72,
  },
  ruleBox: {
    backgroundColor: theme.colors.surface1,
    padding: 10,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing[3],
  },
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.destructive ?? "#f87171",
    fontSize: theme.fontSize.sm,
    marginBottom: theme.spacing[2],
  },
}));
