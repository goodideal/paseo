import React from "react";
import { View, Text, ScrollView } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

export type PluginTheme = PluginSurfaceProps["theme"];

export interface AuditTimelineEvent {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  timestamp: string;
  status?: "succeeded" | "failed" | "pending" | "running";
}

export interface AuditTimelineProps {
  events: AuditTimelineEvent[];
  theme: PluginTheme;
}

export function AuditTimeline({ events, theme }: AuditTimelineProps) {
  if (events.length === 0) {
    return (
      <View style={{ padding: 16, alignItems: "center" }}>
        <Text style={{ color: theme.colors.foregroundMuted }}>暂无审计记录</Text>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, padding: 16 }}>
      {events.map((ev, index) => {
        const dotColor =
          ev.status === "succeeded"
            ? theme.colors.statusSuccess
            : ev.status === "failed"
              ? theme.colors.statusDanger
              : ev.status === "pending"
                ? theme.colors.statusWarning
                : theme.colors.accent;

        return (
          <View
            key={ev.id || index}
            style={{
              flexDirection: "row",
              marginBottom: 16,
              alignItems: "flex-start",
            }}
          >
            <View
              style={{
                width: 10,
                height: 10,
                borderRadius: 5,
                backgroundColor: dotColor,
                marginTop: 5,
                marginRight: 12,
              }}
            />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ color: theme.colors.foreground, fontWeight: "500" }}>
                  {ev.title}
                </Text>
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ""}
                </Text>
              </View>
              {ev.description ? (
                <Text style={{ color: theme.colors.foregroundMuted, marginTop: 4, fontSize: 13 }}>
                  {ev.description}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
