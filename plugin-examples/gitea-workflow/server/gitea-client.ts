import type { GiteaSettings } from "../shared/types.js";

export interface GiteaIssueDto {
  number: number;
  title: string;
  body: string;
  html_url: string;
  labels: Array<{ name: string }>;
}

export interface FetchIssuesOptions {
  page?: number;
  limit?: number;
}

export class GiteaClient {
  constructor(private readonly config: GiteaSettings) {}

  private get headers(): Record<string, string> {
    return {
      Authorization: `token ${this.config.giteaToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  private url(endpoint: string): string {
    const base = this.config.giteaUrl.replace(/\/+$/, "");
    return `${base}/api/v1/repos/${this.config.repoOwner}/${this.config.repoName}${endpoint}`;
  }

  async fetchReadyIssues(options?: FetchIssuesOptions): Promise<GiteaIssueDto[]> {
    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const res = await fetch(
      this.url(
        `/issues?state=open&labels=${encodeURIComponent(this.config.listenLabel)}&page=${page}&limit=${limit}`,
      ),
      { headers: this.headers },
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch issues: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as GiteaIssueDto[];
  }

  async claimIssue(issueNumber: number): Promise<void> {
    // 1. Remove listen label (ignore 404 if already removed, but throw on auth/server errors)
    const deleteRes = await fetch(
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.config.listenLabel)}`),
      { method: "DELETE", headers: this.headers },
    );
    if (!deleteRes.ok && deleteRes.status !== 404) {
      throw new Error(
        `Failed to remove label ${this.config.listenLabel}: ${deleteRes.status} ${deleteRes.statusText}`,
      );
    }

    // 2. Add in-progress label
    const addLabelRes = await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.config.inProgressLabel] }),
    });
    if (!addLabelRes.ok) {
      throw new Error(
        `Failed to add label ${this.config.inProgressLabel}: ${addLabelRes.status} ${addLabelRes.statusText}`,
      );
    }

    // 3. Post claim comment
    const commentRes = await fetch(this.url(`/issues/${issueNumber}/comments`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        body: "🤖 **Paseo Agent** has claimed this task. An isolated Git worktree workspace is being provisioned.",
      }),
    });
    if (!commentRes.ok) {
      throw new Error(
        `Failed to post claim comment: ${commentRes.status} ${commentRes.statusText}`,
      );
    }
  }

  async markReviewed(issueNumber: number): Promise<void> {
    const deleteRes = await fetch(
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.config.inProgressLabel)}`),
      { method: "DELETE", headers: this.headers },
    );
    if (!deleteRes.ok && deleteRes.status !== 404) {
      throw new Error(
        `Failed to remove label ${this.config.inProgressLabel}: ${deleteRes.status} ${deleteRes.statusText}`,
      );
    }

    const addLabelRes = await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.config.reviewedLabel] }),
    });
    if (!addLabelRes.ok) {
      throw new Error(
        `Failed to add label ${this.config.reviewedLabel}: ${addLabelRes.status} ${addLabelRes.statusText}`,
      );
    }
  }

  async createPullRequest(params: {
    title: string;
    body: string;
    headBranch: string;
    baseBranch: string;
  }): Promise<{ url: string }> {
    const res = await fetch(this.url("/pulls"), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        title: params.title,
        body: params.body,
        head: params.headBranch,
        base: params.baseBranch,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create pull request: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { html_url: string };
    return { url: data.html_url };
  }
}
