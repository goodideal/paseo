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

export interface GiteaClientConfig {
  giteaUrl: string;
  giteaToken: string;
  repoOwner: string;
  repoName: string;
  listenLabel?: string;
  inProgressLabel?: string;
  reviewedLabel?: string;
  pollIntervalSeconds?: number;
  maxConcurrentWorktrees?: number;
}

export class GiteaClient {
  private readonly listenLabel: string;
  private readonly inProgressLabel: string;
  private readonly reviewedLabel: string;

  constructor(private readonly config: GiteaClientConfig) {
    this.listenLabel = config.listenLabel ?? "agent-ready";
    this.inProgressLabel = config.inProgressLabel ?? "agent-in-progress";
    this.reviewedLabel = config.reviewedLabel ?? "agent-reviewed";
  }

  private get headers(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.config.giteaToken) {
      headers.Authorization = `token ${this.config.giteaToken}`;
    }
    return headers;
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
        `/issues?state=open&labels=${encodeURIComponent(this.listenLabel)}&page=${page}&limit=${limit}`,
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
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.listenLabel)}`),
      { method: "DELETE", headers: this.headers },
    );
    if (!deleteRes.ok && deleteRes.status !== 404) {
      throw new Error(
        `Failed to remove label ${this.listenLabel}: ${deleteRes.status} ${deleteRes.statusText}`,
      );
    }

    // 2. Add in-progress label
    const addLabelRes = await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.inProgressLabel] }),
    });
    if (!addLabelRes.ok) {
      throw new Error(
        `Failed to add label ${this.inProgressLabel}: ${addLabelRes.status} ${addLabelRes.statusText}`,
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
      this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(this.inProgressLabel)}`),
      { method: "DELETE", headers: this.headers },
    );
    if (!deleteRes.ok && deleteRes.status !== 404) {
      throw new Error(
        `Failed to remove label ${this.inProgressLabel}: ${deleteRes.status} ${deleteRes.statusText}`,
      );
    }

    const addLabelRes = await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: [this.reviewedLabel] }),
    });
    if (!addLabelRes.ok) {
      throw new Error(
        `Failed to add label ${this.reviewedLabel}: ${addLabelRes.status} ${addLabelRes.statusText}`,
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
