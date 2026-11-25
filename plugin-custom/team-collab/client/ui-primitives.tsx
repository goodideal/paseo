import React, { memo, useMemo, useState } from "react";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import type { PluginHostProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";

export type DateRangePreset = "7d" | "30d" | "90d" | "all";

export function monoFontFamily(platform: PluginHostProps["layout"]["platform"]): string {
  if (platform === "ios") return "Menlo";
  if (platform === "android") return "monospace";
  return "ui-monospace, SFMono-Regular, Menlo, monospace";
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return `${m >= 10 ? m.toFixed(1) : m.toFixed(2)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1)}k`;
  }
  return String(Math.round(value));
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "$0.00";
  if (value < 0.01) return `<$0.01`;
  if (value >= 100) {
    return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${value.toFixed(2)}`;
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

export function formatShortTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month}-${day} ${hours}:${mins}`;
}

function toYmdLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function resolveDateRangeFromPreset(preset: DateRangePreset): {
  fromDate?: string;
  toDate?: string;
} {
  if (preset === "all") {
    return {};
  }
  const now = new Date();
  const toDate = toYmdLocal(now);
  let daysBack = 89;
  if (preset === "7d") {
    daysBack = 6;
  } else if (preset === "30d") {
    daysBack = 29;
  }
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysBack);
  return {
    fromDate: toYmdLocal(start),
    toDate,
  };
}

export type ActionButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";

export interface ActionButtonProps {
  label?: string;
  accessibilityLabel?: string;
  icon?: string;
  variant?: ActionButtonVariant;
  compactSize?: boolean;
  disabled?: boolean;
  theme: PluginTheme;
  compactLayout: boolean;
  onPress(): void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export const ActionButton = memo(function ActionButton({
  label,
  accessibilityLabel,
  icon,
  variant = "secondary",
  compactSize = false,
  disabled = false,
  theme,
  compactLayout,
  onPress,
  style,
  textStyle,
}: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  let minHeight = 32;
  if (compactLayout) {
    minHeight = compactSize ? 36 : 44;
  } else if (compactSize) {
    minHeight = 28;
  }

  const palette = useMemo(() => {
    switch (variant) {
      case "primary":
        return {
          bg: theme.colors.accent,
          hoverBg: theme.colors.accent,
          border: theme.colors.accent,
          fg: theme.colors.accentForeground,
          hasBorder: true,
        };
      case "danger":
        return {
          bg: theme.colors.statusDanger,
          hoverBg: theme.colors.statusDanger,
          border: theme.colors.statusDanger,
          fg: theme.colors.accentForeground,
          hasBorder: true,
        };
      case "outline":
        return {
          bg: "transparent",
          hoverBg: theme.colors.surface2,
          border: theme.colors.border,
          fg: theme.colors.foreground,
          hasBorder: true,
        };
      case "ghost":
        return {
          bg: "transparent",
          hoverBg: theme.colors.surface2,
          border: "transparent",
          fg: theme.colors.foregroundMuted,
          hasBorder: false,
        };
      case "secondary":
      default:
        return {
          bg: theme.colors.surface2,
          hoverBg: theme.colors.surface1,
          border: theme.colors.border,
          fg: theme.colors.foreground,
          hasBorder: true,
        };
    }
  }, [theme.colors, variant]);

  const iconOnly = Boolean(icon && !label);
  let horizontalPad = 16;
  if (iconOnly) {
    horizontalPad = 0;
  } else if (compactSize) {
    horizontalPad = 12;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? icon ?? "Action"}
      disabled={disabled}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onPress={onPress}
      style={({ pressed }) => [
        uiStyles.buttonBase,
        {
          minHeight,
          minWidth: iconOnly ? minHeight : undefined,
          paddingHorizontal: horizontalPad,
          backgroundColor: hovered && !disabled ? palette.hoverBg : palette.bg,
          borderColor: palette.border,
          borderWidth: palette.hasBorder ? 1 : 0,
        },
        disabled && uiStyles.disabled,
        pressed && !disabled && uiStyles.pressed,
        style,
      ]}
    >
      {icon ? (
        <Icon
          name={icon}
          size={compactSize ? 14 : 16}
          color={variant === "ghost" && hovered && !disabled ? theme.colors.foreground : palette.fg}
        />
      ) : null}
      {label ? (
        <Text
          numberOfLines={1}
          style={[
            uiStyles.buttonLabel,
            {
              fontSize: compactSize ? 12 : 13,
              color:
                variant === "ghost" && hovered && !disabled ? theme.colors.foreground : palette.fg,
            },
            textStyle,
          ]}
        >
          {label}
        </Text>
      ) : null}
    </Pressable>
  );
});

export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

export function SegmentedTabs<Value extends string>({
  options,
  value,
  onChange,
  theme,
  compactLayout,
}: {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange(next: Value): void;
  theme: PluginTheme;
  compactLayout: boolean;
}) {
  const minHeight = compactLayout ? 36 : 28;
  return (
    <View
      style={[
        uiStyles.segmentTrack,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(opt.value)}
            style={({ pressed }) => [
              uiStyles.segmentItem,
              {
                minHeight,
                backgroundColor: active ? theme.colors.surface2 : "transparent",
                borderColor: active ? theme.colors.border : "transparent",
              },
              pressed && uiStyles.pressed,
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                uiStyles.segmentLabel,
                {
                  color: active ? theme.colors.foreground : theme.colors.foregroundMuted,
                  fontWeight: active ? "500" : "400",
                },
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "accent";

export const StatusTag = memo(function StatusTag({
  label,
  icon,
  tone = "neutral",
  mono = false,
  platform,
  theme,
}: {
  label: string;
  icon?: string;
  tone?: StatusTone;
  mono?: boolean;
  platform: PluginHostProps["layout"]["platform"];
  theme: PluginTheme;
}) {
  const fgColor = useMemo(() => {
    switch (tone) {
      case "success":
        return theme.colors.statusSuccess;
      case "warning":
        return theme.colors.statusWarning;
      case "danger":
        return theme.colors.statusDanger;
      case "accent":
        return theme.colors.accent;
      case "neutral":
      default:
        return theme.colors.foregroundMuted;
    }
  }, [theme.colors, tone]);

  return (
    <View
      style={[
        uiStyles.tag,
        {
          backgroundColor: theme.colors.surface2,
          borderColor: theme.colors.border,
        },
      ]}
    >
      {icon ? <Icon name={icon} size={12} color={fgColor} /> : null}
      <Text
        numberOfLines={1}
        style={[
          uiStyles.tagText,
          {
            color: fgColor,
            fontFamily: mono ? monoFontFamily(platform) : undefined,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

const uiStyles = StyleSheet.create({
  buttonBase: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 999,
  },
  buttonLabel: {
    fontWeight: "500",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.78,
  },
  segmentTrack: {
    flexDirection: "row",
    alignItems: "center",
    padding: 2,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
  },
  segmentItem: {
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentLabel: {
    fontSize: 12,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagText: {
    fontSize: 11,
    fontWeight: "400",
    fontVariant: ["tabular-nums"],
  },
});
