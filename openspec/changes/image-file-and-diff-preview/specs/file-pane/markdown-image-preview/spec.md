## Purpose

Enables reliable cross-platform previewing of local relative and workspace-relative images referenced in Markdown documents in FilePane.

## ADDED Requirements

### Requirement: Relative Image Path Resolution in Markdown Preview

The system SHALL resolve relative image references (`./`, `../`, and path segments) within Markdown documents against the directory of the document currently being viewed.

#### Scenario: Resolving relative image in subfolder

- **WHEN** user views `docs/architecture/overview.md` which contains `![diagram](./assets/flow.png)`
- **THEN** system resolves the image path to `docs/architecture/assets/flow.png` within the workspace root

#### Scenario: Preserving external and data URLs

- **WHEN** user views a Markdown document containing `https://example.com/logo.png` or `data:image/png;base64,...`
- **THEN** system renders the image directly without rewriting to a local workspace file path

### Requirement: Safe Image Fetching and Local Attachment Store Bridge

The system SHALL fetch local image bytes using the daemon client read service, enforce workspace boundary checks, and cache preview attachments for UI display.

#### Scenario: Successfully loading and rendering local workspace image

- **WHEN** a relative image points to an existing file in the workspace
- **THEN** system reads the binary bytes, creates a local attachment URL, displays a loading skeleton until ready, and renders the image with appropriate aspect ratio

#### Scenario: Handling missing or corrupted image files

- **WHEN** a relative image references a non-existent file or corrupted data
- **THEN** system displays a graceful error fallback card showing the attempted filename and path without crashing the preview

### Requirement: Full-Screen Lightbox Zoom

The system SHALL allow users to tap or click an inline Markdown image to open it in a full-screen Lightbox viewer with zoom and pan gestures.

#### Scenario: Opening image in lightbox

- **WHEN** user taps on a rendered Markdown image
- **THEN** system opens the ImageLightbox showing the image in high resolution with pinch-to-zoom and pan support
