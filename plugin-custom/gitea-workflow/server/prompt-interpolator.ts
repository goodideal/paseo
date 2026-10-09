export interface PromptInterpolationContext {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  repoOwner: string;
  repoName: string;
  branchName?: string;
  projectId?: string;
}

export function interpolatePrompt(template: string, context: PromptInterpolationContext): string {
  if (!template || typeof template !== "string") {
    return "";
  }

  const rawBody = typeof context?.issueBody === "string" ? context.issueBody.trim() : "";
  const effectiveBody = rawBody || "(No description provided)";

  const replacements: Record<string, string> = {
    issueNumber: String(context?.issueNumber ?? ""),
    issueTitle: context?.issueTitle || "",
    issueBody: effectiveBody,
    repoOwner: context?.repoOwner || "",
    repoName: context?.repoName || "",
    branchName: context?.branchName || "",
    projectId: context?.projectId || "",
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match;
  });
}
