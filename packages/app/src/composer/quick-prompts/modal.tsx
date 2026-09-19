import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Pencil, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet } from "@/components/adaptive-modal-sheet";
import { AdaptiveTextInput } from "@/components/adaptive-text-input";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  useQuickPromptsStore,
  type QuickPromptItem,
  type QuickPromptTriggerType,
} from "@/stores/quick-prompts-store";

export interface QuickPromptsModalProps {
  visible: boolean;
  onClose: () => void;
}

type ModalViewMode = "list" | "edit" | "create";

interface PromptFormState {
  label: string;
  content: string;
  shortcut: string;
  triggerType: QuickPromptTriggerType;
  keywords: string;
  regex: string;
}

const EMPTY_FORM: PromptFormState = {
  label: "",
  content: "",
  shortcut: "",
  triggerType: "fixed",
  keywords: "",
  regex: "",
};

const QuickPromptItemCard = memo(function QuickPromptItemCard({
  item,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: QuickPromptItem;
  onToggle: (id: string) => void;
  onEdit: (item: QuickPromptItem) => void;
  onDelete: (id: string) => void;
}) {
  const handleToggle = useCallback(() => onToggle(item.id), [item.id, onToggle]);
  const handleEdit = useCallback(() => onEdit(item), [item, onEdit]);
  const handleDelete = useCallback(() => onDelete(item.id), [item.id, onDelete]);

  const isRule = item.triggerType === "rule";

  return (
    <View style={styles.itemCard} testID={`quick-prompt-item-${item.id}`}>
      <View style={styles.itemHeader}>
        <View style={styles.itemTitleRow}>
          <Switch
            value={item.enabled}
            onValueChange={handleToggle}
            testID={`quick-prompt-toggle-${item.id}`}
          />
          <Text style={styles.itemLabel}>{item.label}</Text>
          {item.shortcut ? (
            <View style={styles.badgeShortcut}>
              <Text style={styles.badgeShortcutText}>/{item.shortcut}</Text>
            </View>
          ) : null}
          <View style={[styles.badgeTrigger, isRule && styles.badgeTriggerRule]}>
            {isRule ? <Sparkles size={10} color={styles.ruleIcon.color} /> : null}
            <Text style={[styles.badgeTriggerText, isRule && styles.badgeTriggerTextRule]}>
              {item.triggerType === "fixed" ? "常驻" : "动态规则"}
            </Text>
          </View>
        </View>

        <View style={styles.itemActions}>
          <Pressable
            onPress={handleEdit}
            style={styles.actionIconBtn}
            accessibilityLabel="编辑"
            testID={`quick-prompt-edit-${item.id}`}
          >
            <Pencil size={14} color={styles.actionIcon.color} />
          </Pressable>
          <Pressable
            onPress={handleDelete}
            style={styles.actionIconBtn}
            accessibilityLabel="删除"
            testID={`quick-prompt-delete-${item.id}`}
          >
            <Trash2 size={14} color={styles.dangerIcon.color} />
          </Pressable>
        </View>
      </View>

      <Text style={styles.itemContentPreview} numberOfLines={2}>
        {item.content}
      </Text>
    </View>
  );
});

const TRIGGER_TYPE_OPTIONS = [
  { value: "fixed" as const, label: "常驻 (固定在气泡栏)" },
  { value: "rule" as const, label: "动态规则 (条件触发)" },
];

export function QuickPromptsModal({ visible, onClose }: QuickPromptsModalProps) {
  const items = useQuickPromptsStore((state) => state.items);
  const addItem = useQuickPromptsStore((state) => state.addItem);
  const updateItem = useQuickPromptsStore((state) => state.updateItem);
  const deleteItem = useQuickPromptsStore((state) => state.deleteItem);
  const toggleItem = useQuickPromptsStore((state) => state.toggleItem);
  const resetToDefaults = useQuickPromptsStore((state) => state.resetToDefaults);

  const [mode, setMode] = useState<ModalViewMode>("list");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [form, setForm] = useState<PromptFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    setMode("create");
  }, []);

  const handleStartEdit = useCallback((item: QuickPromptItem) => {
    setForm({
      label: item.label,
      content: item.content,
      shortcut: item.shortcut ?? "",
      triggerType: item.triggerType,
      keywords: (item.ruleCondition?.keywords ?? []).join(", "),
      regex: item.ruleCondition?.regex ?? "",
    });
    setEditingItemId(item.id);
    setError(null);
    setMode("edit");
  }, []);

  const handleSave = useCallback(() => {
    const trimmedLabel = form.label.trim();
    const trimmedContent = form.content.trim();

    if (!trimmedLabel) {
      setError("请输入常用语标签名称");
      return;
    }
    if (!trimmedContent) {
      setError("请输入完整提示词内容");
      return;
    }

    const shortcut = form.shortcut.trim().replace(/^\//, "") || undefined;
    const keywords = form.keywords
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    const regex = form.regex.trim() || undefined;

    const ruleCondition =
      form.triggerType === "rule" && (keywords.length > 0 || regex)
        ? {
            ...(keywords.length > 0 ? { keywords } : {}),
            ...(regex ? { regex } : {}),
          }
        : undefined;

    if (mode === "create") {
      addItem({
        label: trimmedLabel,
        content: trimmedContent,
        shortcut,
        triggerType: form.triggerType,
        ruleCondition,
        enabled: true,
      });
    } else if (mode === "edit" && editingItemId) {
      updateItem(editingItemId, {
        label: trimmedLabel,
        content: trimmedContent,
        shortcut,
        triggerType: form.triggerType,
        ruleCondition,
      });
    }

    setMode("list");
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, [addItem, updateItem, editingItemId, form, mode]);

  const handleCancelEdit = useCallback(() => {
    setMode("list");
    setEditingItemId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }, []);

  const handleLabelChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, label: v }));
    setError(null);
  }, []);

  const handleContentChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, content: v }));
    setError(null);
  }, []);

  const handleShortcutChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, shortcut: v }));
  }, []);

  const handleTriggerTypeChange = useCallback((t: QuickPromptTriggerType) => {
    setForm((prev) => ({ ...prev, triggerType: t }));
  }, []);

  const handleKeywordsChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, keywords: v }));
  }, []);

  const handleRegexChange = useCallback((v: string) => {
    setForm((prev) => ({ ...prev, regex: v }));
  }, []);

  const sheetTitle = useMemo(() => {
    if (mode === "create") {
      return "新建常用语";
    }
    if (mode === "edit") {
      return "编辑常用语";
    }
    return "常用语与快捷指令";
  }, [mode]);

  const sheetHeader = useMemo(() => ({ title: sheetTitle }), [sheetTitle]);

  return (
    <AdaptiveModalSheet visible={visible} onClose={handleClose} header={sheetHeader}>
      <View style={styles.container}>
        {mode === "list" ? (
          <View style={styles.listContainer}>
            <View style={styles.topActions}>
              <Button
                variant="default"
                size="sm"
                onPress={handleStartCreate}
                testID="quick-prompt-create-button"
              >
                <Plus size={14} color="white" />
                <Text style={styles.buttonTextWhite}>新建常用语</Text>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onPress={resetToDefaults}
                testID="quick-prompt-reset-button"
              >
                <RotateCcw size={13} color={styles.outlineIcon.color} />
                <Text style={styles.buttonText}>恢复默认</Text>
              </Button>
            </View>

            <ScrollView style={styles.itemList} showsVerticalScrollIndicator={false}>
              {items.map((item) => (
                <QuickPromptItemCard
                  key={item.id}
                  item={item}
                  onToggle={toggleItem}
                  onEdit={handleStartEdit}
                  onDelete={deleteItem}
                />
              ))}
            </ScrollView>
          </View>
        ) : (
          <ScrollView style={styles.formContainer} showsVerticalScrollIndicator={false}>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>常用语短名称（气泡展示文本）*</Text>
              <AdaptiveTextInput
                initialValue={form.label}
                onChangeText={handleLabelChange}
                placeholder="例如：修复测试 / 代码审查"
                style={styles.textInput}
                testID="quick-prompt-form-label"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>实际发送的完整提示词 (Prompt)*</Text>
              <AdaptiveTextInput
                initialValue={form.content}
                onChangeText={handleContentChange}
                placeholder="例如：请分析上述报错信息，定位根本原因并完成修复..."
                multiline
                style={[styles.textInput, styles.textAreaInput]}
                testID="quick-prompt-form-content"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>可选斜杠指令（在输入框输入 / 时快速展开）</Text>
              <AdaptiveTextInput
                initialValue={form.shortcut}
                onChangeText={handleShortcutChange}
                placeholder="例如：fix（支持输入 /fix 联想替换）"
                autoCapitalize="none"
                style={styles.textInput}
                testID="quick-prompt-form-shortcut"
              />
            </View>

            <View style={styles.formField}>
              <Text style={styles.fieldLabel}>触发显示类型</Text>
              <SegmentedControl<QuickPromptTriggerType>
                value={form.triggerType}
                onValueChange={handleTriggerTypeChange}
                options={TRIGGER_TYPE_OPTIONS}
                testID="quick-prompt-form-trigger"
              />
            </View>

            {form.triggerType === "rule" ? (
              <View style={styles.ruleBox}>
                <View style={styles.formField}>
                  <Text style={styles.fieldLabel}>上一轮回复包含的关键词（逗号分隔）</Text>
                  <AdaptiveTextInput
                    initialValue={form.keywords}
                    onChangeText={handleKeywordsChange}
                    placeholder="例如：error, failed, 报错, 失败"
                    style={styles.textInput}
                    testID="quick-prompt-form-keywords"
                  />
                </View>

                <View style={styles.formField}>
                  <Text style={styles.fieldLabel}>上一轮回复匹配的正规表达式（可选）</Text>
                  <AdaptiveTextInput
                    initialValue={form.regex}
                    onChangeText={handleRegexChange}
                    placeholder="例如：(y/n)|请确认"
                    autoCapitalize="none"
                    style={styles.textInput}
                    testID="quick-prompt-form-regex"
                  />
                </View>
              </View>
            ) : null}

            <View style={styles.formActions}>
              <Button variant="secondary" size="sm" onPress={handleCancelEdit}>
                取消
              </Button>
              <Button
                variant="default"
                size="sm"
                onPress={handleSave}
                testID="quick-prompt-form-save"
              >
                保存
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
    maxHeight: 520,
    paddingBottom: theme.spacing[2],
  },
  listContainer: {
    gap: theme.spacing[3],
  },
  topActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    maxHeight: 440,
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
  },
  itemLabel: {
    fontSize: theme.fontSize.sm,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  badgeShortcut: {
    backgroundColor: theme.colors.surface3,
    paddingHorizontal: theme.spacing[1.5],
    paddingVertical: 2,
    borderRadius: theme.borderRadius.sm,
  },
  badgeShortcutText: {
    fontSize: theme.fontSize.sm,
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
  actionIconBtn: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.sm,
  },
  actionIcon: {
    color: theme.colors.foregroundMuted,
  },
  dangerIcon: {
    color: theme.colors.destructive ?? "#f87171",
  },
  itemContentPreview: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    lineHeight: 16,
  },
  formContainer: {
    maxHeight: 460,
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
