# provider-management/acp-catalog-decoupling Specification

## Purpose

Decouples hardcoded custom ACP providers from the core built-in ACP catalog, restoring the core repository to clean upstream alignment while supporting custom agents through standard configuration or plugins.

## Requirements

### Requirement: Upstream-Compliant Core ACP Catalog

The core ACP provider catalog in `packages/app/src/data/acp-provider-catalog.ts` SHALL strictly contain only upstream-supported agents, excluding unmerged custom community providers.

#### Scenario: Listing core ACP providers

- **WHEN** the app inspects `ACP_PROVIDER_CATALOG`
- **THEN** internal custom provider identifiers such as `antigravity` are absent from the built-in list.

### Requirement: Standard Custom ACP Configuration Path

The system SHALL support custom and community ACP agents via the existing `config.json` custom provider schema (`extends: "acp"`) without modifying core source files.

#### Scenario: Configuring community agent via config

- **WHEN** a user defines an ACP provider in `~/.paseo/config.json` with `extends: "acp"`
- **THEN** Paseo loads and presents the custom provider in the agent selection catalog.
