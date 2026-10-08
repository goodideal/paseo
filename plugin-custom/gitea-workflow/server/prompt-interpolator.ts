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

  const replacements: Record<string, string> = {
    issueNumber: String(context?.issueNumber ?? ""),
    issueTitle: context?.issueTitle || "",
    issueBody: context?.issueBody || "",
    repoOwner: context?.repoOwner || "",
    repoName: context?.repoName || "",
    branchName: context?.branchName || "",
    projectId: context?.projectId || "",
  };

  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? replacements[key] : match;
  });
}
