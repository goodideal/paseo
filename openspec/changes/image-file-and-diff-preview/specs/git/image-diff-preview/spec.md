## Purpose

Provides a visual 2-Up side-by-side and stacked comparison of modified, added, and deleted image assets in Git Diff.

## ADDED Requirements

### Requirement: Daemon Git Blob Retrieval RPC

The daemon SHALL provide a typed WebSocket RPC `workspace.git.blob.request` to securely read historical Git blob data by ref and file path, subject to maximum size limits and directory traversal checks.

#### Scenario: Reading valid git blob at ref

- **WHEN** client sends `workspace.git.blob.request` with `cwd`, `ref="HEAD"`, and `path="assets/logo.png"`
- **THEN** daemon returns `workspace.git.blob.response` with `status="ok"`, inferred mimeType, size, and raw binary bytes

#### Scenario: Enforcing 5MB image size limit

- **WHEN** requested blob exceeds 5MB
- **THEN** daemon returns `status="too_large"` with file size metadata without streaming the large payload over WebSocket

#### Scenario: Rejecting directory traversal

- **WHEN** client requests a path containing `../` outside the repository boundary
- **THEN** daemon rejects the request with an error and does not access files outside the workspace

### Requirement: Feature Gated Image Diff Presentation

The system SHALL check daemon feature capability `gitImageDiff` and render a 2-Up visual comparison card for image files in Git Diff when supported, falling back to binary placeholder when unsupported.

#### Scenario: Modified image file diff

- **WHEN** an image file has changes between base ref and working tree / commit
- **THEN** system renders a 2-Up card showing Before (from base ref) and After (from target ref/working tree) with dimensions, file size, and percentage change indicator

#### Scenario: Newly added image file

- **WHEN** an image file is newly created (`isNew=true`)
- **THEN** system renders the After card labeled "Added" with file metadata, omitting the Before card

#### Scenario: Deleted image file

- **WHEN** an image file is deleted (`isDeleted=true`)
- **THEN** system renders the Before card labeled "Deleted" with historical file metadata, omitting the After card

### Requirement: Responsive Layout and Checkerboard Background

The system SHALL display the Before and After views side-by-side on wide screens and vertically stacked on compact/mobile screens, with a subtle 2x2 checkerboard pattern behind transparent images.

#### Scenario: Mobile viewport responsiveness

- **WHEN** DiffPane is displayed on a compact form factor (`useIsCompactFormFactor() === true`)
- **THEN** Before and After image cards stack vertically while retaining full metadata and touch-friendly dimensions

#### Scenario: Transparent image rendering

- **WHEN** displaying PNG, WebP, or SVG images with transparency
- **THEN** the image background renders with a theme-aware checkerboard pattern to ensure contrast
