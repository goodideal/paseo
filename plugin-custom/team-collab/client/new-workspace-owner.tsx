import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useNewWorkspace,
  useRpc,
  useTranslation,
  type PluginNewWorkspaceItemProps,
} from "@getpaseo/plugin/client";
import { Select } from "@getpaseo/plugin/client/ui";
import {
  parseWorkspaceOwnerMetadata,
  TEAM_COLLAB_OWNER_META_KEY,
  teamCollabRosterStatusRpc,
  type RosterMemberStatus,
  type TeamCollabPolicies,
} from "../shared/contracts.js";
import { messages } from "./messages.js";
import { useDefaultMemberId } from "./web.js";
import { useRosterRefreshVersion } from "./workspace-store.js";

const UNCLAIMED_VALUE = "__unclaimed__" as const;
type OptionalProjectKey = string | null;

export const NewWorkspaceOwnerItem = memo(function NewWorkspaceOwnerItem(
  _props: PluginNewWorkspaceItemProps,
) {
  const { t } = useTranslation(messages);
  const newWorkspace = useNewWorkspace();
  const queryRoster = useRpc(teamCollabRosterStatusRpc);
  const [defaultMemberId, setDefaultMemberId] = useDefaultMemberId();
  const rosterRefreshVersion = useRosterRefreshVersion();

  const [members, setMembers] = useState<RosterMemberStatus[]>([]);
  const [policies, setPolicies] = useState<TeamCollabPolicies | null>(null);

  const projectKey = newWorkspace.project?.id ?? "__no_project__";
  const manuallyClearedForProjectRef = useRef<OptionalProjectKey>(null);
  const enforcedWorktreeForProjectRef = useRef<OptionalProjectKey>(null);

  useEffect(() => {
    let cancelled = false;
    void queryRoster({})
      .then((res) => {
        if (cancelled) return;
        setMembers(res.members);
        setPolicies(res.policies);
      })
      .catch(() => {
        // Ignore transient daemon RPC error while New Workspace initializes
      });
    return () => {
      cancelled = true;
    };
  }, [queryRoster, rosterRefreshVersion]);

  const enabledMembers = useMemo(() => members.filter((m) => m.enabled !== false), [members]);

  const currentOwner = useMemo(
    () => parseWorkspaceOwnerMetadata(newWorkspace.metadata),
    [newWorkspace.metadata],
  );

  // 1. Auto-prefill workspace owner from this device's remembered member identity
  useEffect(() => {
    if (currentOwner !== null) {
      return;
    }
    if (manuallyClearedForProjectRef.current === projectKey) {
      return;
    }
    if (!defaultMemberId) {
      return;
    }
    const matched = enabledMembers.find((m) => m.id === defaultMemberId);
    if (!matched) {
      return;
    }
    void newWorkspace
      .setMetadata({
        [TEAM_COLLAB_OWNER_META_KEY]: {
          id: matched.id,
          name: matched.name,
          email: matched.email,
          kind: "member",
          assignedAt: new Date().toISOString(),
        },
      })
      .catch(() => undefined);
  }, [currentOwner, defaultMemberId, enabledMembers, newWorkspace, projectKey]);

  // 2. Guide New Workspace toward isolated Git worktree when policy requires it
  useEffect(() => {
    if (!policies?.enforceWorktreeOnCreate) {
      return;
    }
    if (!newWorkspace.project || newWorkspace.isolation !== "local") {
      return;
    }
    if (enforcedWorktreeForProjectRef.current === newWorkspace.project.id) {
      return;
    }
    enforcedWorktreeForProjectRef.current = newWorkspace.project.id;
    void newWorkspace.setIsolation("worktree").catch(() => undefined);
  }, [newWorkspace, policies?.enforceWorktreeOnCreate]);

  const options = useMemo(() => {
    const list: Array<{ value: string; label: string; description?: string }> = [
      {
        value: UNCLAIMED_VALUE,
        label: t("newWorkspace.unclaimedOption"),
        description: t("newWorkspace.unclaimedDesc"),
      },
    ];
    for (const member of enabledMembers) {
      list.push({
        value: member.id,
        label: `${member.name} (@${member.id})`,
        description: member.email,
      });
    }
    if (currentOwner && !list.some((opt) => opt.value === currentOwner.id)) {
      list.push({
        value: currentOwner.id,
        label: `${currentOwner.name} (@${currentOwner.id})`,
        description: currentOwner.email,
      });
    }
    return list;
  }, [currentOwner, enabledMembers, t]);

  const handleValueChange = useCallback(
    async ({ value }: { value: string }) => {
      if (value === UNCLAIMED_VALUE) {
        manuallyClearedForProjectRef.current = projectKey;
        await newWorkspace
          .setMetadata({ [TEAM_COLLAB_OWNER_META_KEY]: null })
          .catch(() => undefined);
        return;
      }
      const selected = enabledMembers.find((m) => m.id === value);
      if (!selected) {
        return;
      }
      manuallyClearedForProjectRef.current = null;
      setDefaultMemberId(selected.id);
      await newWorkspace
        .setMetadata({
          [TEAM_COLLAB_OWNER_META_KEY]: {
            id: selected.id,
            name: selected.name,
            email: selected.email,
            kind: "member",
            assignedAt: new Date().toISOString(),
          },
        })
        .catch(() => undefined);
    },
    [enabledMembers, newWorkspace, projectKey, setDefaultMemberId],
  );

  const selectedValue = currentOwner ? currentOwner.id : UNCLAIMED_VALUE;
  let icon = "Users";
  if (currentOwner?.kind === "bot") {
    icon = "Bot";
  } else if (currentOwner) {
    icon = "UserCheck";
  }

  return (
    <Select
      title={t("newWorkspace.ownerTitle")}
      icon={icon}
      value={selectedValue}
      options={options}
      onValueChange={handleValueChange}
    />
  );
});
