# Gitea Automated Worktree Workflow Plugin for Paseo

This plugin provides an automated pipeline for monitoring Gitea issues, spinning up isolated Git worktrees, dispatching coding and self-review agents, launching project dev servers to capture web rendering screenshots via headless browser automation, and presenting an approval workbench in the Paseo client.

## Features

- **Issue Polling**: Monitors Gitea for issues labeled `agent-ready`.
- **Worktree Isolation**: Spins up a clean, dedicated worktree per task to isolate changes.
- **Service Proxy & Headless Screenshots**: Uses Paseo Service Proxy to access local dev servers and captures Desktop and Mobile viewports.
- **Native Review Workbench**: View screenshots, Git diffs, and approve or reject tasks inside Paseo.
- **Lifecycle Closure**: Automatically pushes branches, creates Gitea Pull Requests, and updates issue labels.

## Installation

```bash
paseo plugin install ./plugin-examples/gitea-workflow
```
