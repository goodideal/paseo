import { getPathBasename } from "@/utils/path";

export function resolveWorkspaceTitle({
  workspace,
  displayName,
  sourceDirectory,
}: {
  workspace: { name?: string | null; projectDisplayName?: string | null } | null;
  displayName: string;
  sourceDirectory: string;
}): string {
  return (
    workspace?.name ||
    workspace?.projectDisplayName ||
    displayName ||
    getPathBasename(sourceDirectory) ||
    sourceDirectory
  );
}
