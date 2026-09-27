export interface GiteaIssueDto {
  number: number;
  title: string;
  body: string;
  html_url: string;
  labels: Array<{ id?: number; name: string }>;
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
        `/issues?state=open&type=issues&labels=${encodeURIComponent(this.listenLabel)}&page=${page}&limit=${limit}`,
      ),
      { headers: this.headers },
    );
    if (!res.ok) {
      throw new Error(`Failed to fetch issues: ${res.status} ${res.statusText}`);
    }
    const rawIssues = (await res.json()) as GiteaIssueDto[];
    if (!Array.isArray(rawIssues)) return [];

    // CRITICAL GUARD:
    // If the label (e.g. "agent-ready") does NOT exist in the repository, Gitea API ignores
    // the labels query parameter and returns all open issues. In addition, /issues includes PRs.
    // We strictly enforce that the issue is NOT a pull request and explicitly contains this.listenLabel.
    return rawIssues.filter((issue) => {
      if ((issue as unknown as { pull_request?: unknown }).pull_request) {
        return false;
      }
      return (
        Array.isArray(issue.labels) &&
        issue.labels.some((l) => l.name.toLowerCase() === this.listenLabel.toLowerCase())
      );
    });
  }

  async getRepoLabels(): Promise<Array<{ id: number; name: string }>> {
    try {
      const res = await fetch(this.url("/labels?limit=100"), {
        headers: this.headers,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data as Array<{ id: number; name: string }>;
        }
      }
    } catch {
      // ignore lookup error
    }
    return [];
  }

  private async ensureLabelExists(name: string, color: string): Promise<void> {
    try {
      const existing = await this.getRepoLabels();
      if (existing.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
        return;
      }
      await fetch(this.url("/labels"), {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ name, color }),
      });
    } catch {
      // ignore creation failure if label already exists or no permission
    }
  }

  async getIssueLabels(issueNumber: number): Promise<Array<{ id?: number; name: string }>> {
    try {
      const res = await fetch(this.url(`/issues/${issueNumber}/labels`), {
        headers: this.headers,
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          return data as Array<{ id?: number; name: string }>;
        }
      }
    } catch {
      // ignore lookup error
    }
    return [];
  }

  async removeLabelsByName(issueNumber: number, names: string[]): Promise<void> {
    const current = await this.getIssueLabels(issueNumber);
    for (const name of names) {
      const match = current.find((l) => l.name === name);
      if (match?.id) {
        await fetch(this.url(`/issues/${issueNumber}/labels/${match.id}`), {
          method: "DELETE",
          headers: this.headers,
        }).catch(() => {});
      } else {
        await fetch(this.url(`/issues/${issueNumber}/labels/${encodeURIComponent(name)}`), {
          method: "DELETE",
          headers: this.headers,
        }).catch(() => {});
      }
    }
  }

  async addLabelsByName(issueNumber: number, names: string[]): Promise<void> {
    const current = await this.getIssueLabels(issueNumber);
    const toAdd = names.filter(
      (name) => !current.some((l) => l.name.toLowerCase() === name.toLowerCase()),
    );
    if (toAdd.length === 0) return;

    const res = await fetch(this.url(`/issues/${issueNumber}/labels`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ labels: toAdd }),
    });
    if (!res.ok) {
      throw new Error(`Failed to add label: ${res.status} ${res.statusText}`);
    }
  }

  async claimIssue(issueNumber: number, labelId?: number): Promise<void> {
    // 1. Ensure inProgressLabel exists
    await this.ensureLabelExists(this.inProgressLabel, "#fa8c16");

    // 2. Remove listen label and status:backlog
    if (labelId) {
      await fetch(this.url(`/issues/${issueNumber}/labels/${labelId}`), {
        method: "DELETE",
        headers: this.headers,
      }).catch(() => {});
    }
    await this.removeLabelsByName(issueNumber, [this.listenLabel, "status:backlog"]);

    // 3. Add status:doing and inProgressLabel
    await this.addLabelsByName(issueNumber, ["status:doing", this.inProgressLabel]);

    // 4. Post claim comment
    const commentRes = await fetch(this.url(`/issues/${issueNumber}/comments`), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        body: "🤖 **Paseo Agent** has claimed this task. An isolated Git worktree workspace is being provisioned and development has started.",
      }),
    });
    if (!commentRes.ok) {
      throw new Error(
        `Failed to post claim comment: ${commentRes.status} ${commentRes.statusText}`,
      );
    }
  }

  async markReviewed(
    issueNumber: number,
    options?: { prUrl?: string; labelId?: number },
  ): Promise<void> {
    // 1. Ensure reviewedLabel exists
    await this.ensureLabelExists(this.reviewedLabel, "#52c41a");

    // 2. Remove status:doing and inProgressLabel
    if (options?.labelId) {
      await fetch(this.url(`/issues/${issueNumber}/labels/${options.labelId}`), {
        method: "DELETE",
        headers: this.headers,
      }).catch(() => {});
    }
    await this.removeLabelsByName(issueNumber, ["status:doing", this.inProgressLabel]);

    // 3. Add status:review and reviewedLabel
    await this.addLabelsByName(issueNumber, ["status:review", this.reviewedLabel]);

    // 4. Post completion comment with PR URL if provided
    if (options?.prUrl) {
      await fetch(this.url(`/issues/${issueNumber}/comments`), {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          body: `🚀 **Paseo Agent** has completed implementation and opened Pull Request: ${options.prUrl}`,
        }),
      }).catch(() => {});
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
      if (res.status === 409) {
        const match = text.match(/issue_id:\s*(\d+)/);
        if (match?.[1]) {
          const prNumber = match[1];
          const baseUrl = this.config.giteaUrl.replace(/\/+$/, "");
          return {
            url: `${baseUrl}/${this.config.repoOwner}/${this.config.repoName}/pulls/${prNumber}`,
          };
        }
      }
      throw new Error(`Failed to create pull request: ${res.status} ${text}`);
    }

    const data = (await res.json()) as { html_url: string };
    return { url: data.html_url };
  }
}
