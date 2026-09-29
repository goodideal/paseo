# Gitea Superpowers Workflow Plugin for Paseo

This plugin provides an automated, closed-loop pipeline for monitoring Gitea issues, dispatching Claude Code agents with strict `superpowers` workflows (brainstorming, spec design, execution planning, TDD implementation, independent code review), and presenting an interactive approval workbench in the Paseo client.

## Features

- **Zero-Config Credentials & Auto-Discovery**: Resolves Gitea hosts and repositories directly from project Git `origin` remotes, local `tea` login configurations, or environment variables. No tokens are saved in plugin settings.
- **Project-Level Authorization**: Global automation is disabled by default. Administrators explicitly enable automation per-project in Paseo Settings (**Settings → Plugins → Gitea Workflow**).
- **Core Workflow Engine Backed**: Replaces custom state machines with Paseo's native DAG Workflow Engine (`gitea.issue-to-pr` preset).
- **Strict Superpowers Compliance**:
  - `full_superpowers` (Default): Interactive design questions -> Human design approval -> Spec generation -> Spec approval -> Execution planning -> Plan approval -> TDD implementation -> Independent code review -> Delivery manifest approval -> Pull Request creation.
  - `issue_preapproved`: Skips design clarifying gates and begins directly with execution planning.
  - `unattended`: Advances through intermediate steps without pauses, retaining immutable audit records and the mandatory final delivery approval gate.
- **Immutable Delivery Manifest**: Pull requests and remote branch pushes require human sign-off on an immutable `DeliveryApprovalManifest` (source/target branch, commit SHA, PR digest, issue reference), preventing drift.
- **90-Day Evidence Retention**: Auditable lifecycle events are permanently retained; heavy test matrices and screenshot artifacts are automatically pruned after 90 days for terminal runs while protecting all active/pending tasks.

## Installation & Setup

```bash
paseo plugin install ./plugin-custom/gitea-workflow
```

Navigate to **Settings → Plugins → Gitea Workflow** to enable automation and configure project white-lists.
