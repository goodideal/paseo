# Gitea Issue-to-PR Workflow Plugin for Paseo

This plugin provides an automated pipeline for monitoring Gitea issues, dispatching coding and review agents through a 2-track Matt Pocock engineering workflow (`direct_pr` 0-gate delivery and `grill_plan` 1-gate planning), running an automatic verification + two-axis code review quality gate with same-session auto-repair, and delivering Pull Requests directly to Gitea.

## Features

- **Zero-Config Credentials & Auto-Discovery**: Resolves Gitea hosts and repositories directly from project Git `origin` remotes, local `tea` login configurations, or environment variables. No tokens are saved in plugin settings.
- **Project-Level Authorization**: Global automation is disabled by default. Administrators explicitly enable automation per-project in Paseo Settings (**Settings → Plugins → Gitea Workflow**).
- **2-Track Matt Pocock Pipeline**:
  - `direct_pr` (Default, 0-Gate): `fetch-issue` -> `claim-issue` -> `worktree-create` -> `implement-agent` (`diagnosing-bugs` / `codebase-design` + vertical `tdd` + `pr` summary) -> `independent-review` (`gitea.quality_gate`) -> `deliver-pr` (`gitea.deliver_pr`).
  - `grill_plan` (1-Gate): `fetch-issue` -> `claim-issue` -> `worktree-create` -> `plan-agent` (`grilling` + `codebase-design`) -> `gate-plan` (single human confirmation via Gitea comment or Paseo UI) -> `implement-agent` -> `independent-review` -> `deliver-pr`.
- **Automated Quality Gate & Same-Session Repair Loop**:
  - Runs workspace verification (`typecheck` / `tsc` / `go vet` / `cargo check`) and a read-only independent review agent (`code-review` + `open-code-review-delegate`).
  - Automatically resumes the coding agent session for up to `maxAutomaticRepairCycles` (default `2`) to fix verification failures or `[Critical]` review findings.
  - When all checks pass, opens a normal Pull Request via `GiteaClient.createPullRequest` (`Closes #N`, `## Summary`, `## Evidence`, `## Merge Danger`). If blockers remain after exhausting repair cycles, delivers a `[WIP]` Pull Request (`Refs #N`) with detailed blocker diagnostics so work is never stranded in a local worktree.
- **90-Day Evidence Retention**: Auditable lifecycle events are retained while heavy artifacts are automatically pruned after 90 days for terminal runs.

## Installation & Setup

```bash
paseo plugin install ./plugin-custom/gitea-workflow
```

Navigate to **Settings → Plugins → Gitea Workflow** to enable automation and configure project white-lists.
