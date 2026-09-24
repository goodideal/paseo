## Why

Paseo is a mobile and desktop companion for managing AI coding workflows. Users frequently review codebases, documentation, and asset changes directly from their phones or desktop apps. However:

1. In `FilePane`, opening a Markdown file with relative image references (e.g. `![diagram](./assets/arch.png)`) fails to render because React Native `<Image>` cannot resolve local workspace paths, causing blank or broken images.
2. In `DiffPane`, changed image assets (PNG, JPEG, WebP, SVG, ICO, BMP) are classified as binary files and rendered only as a generic "Binary" text label in the canvas view, preventing developers from visually verifying visual assets.

Supporting relative image resolution in Markdown and side-by-side visual comparison in Git Diff unblocks high-fidelity documentation review and asset verification on both mobile and desktop.

## What Changes

- **Markdown Relative Image Resolution**:
  - Contextual resolution of relative and workspace-root image links based on the active file's directory.
  - Safe binary fetching through daemon `client.readFile` and local attachment store, transforming local paths into stable preview URLs.
  - Cross-platform presentation with loading skeletons, fallback state with filename on failure, and tap-to-expand Lightbox support.
- **Git Image Diff Visualization**:
  - Backend capability to fetch historical Git blobs for a given ref (`workspace.git.blob.request` RPC) with strict size limits (5MB) and directory traversal guards.
  - Feature gating via `server_info.features.gitImageDiff`.
  - Frontend 2-Up Side-by-Side comparison card for images in Git Diff (Before vs After with dimensions, file size, and percentage change indicator).
  - Responsive layout: side-by-side on wide screens, stacked on compact/mobile screens (`useIsCompactFormFactor()`).
  - Subtle checkerboard background pattern to clearly show transparent channels in PNG, WebP, and SVG assets.

## Capabilities

### New Capabilities

- `file-pane/markdown-image-preview`: Resolves relative local image paths within Markdown file preview in FilePane, fetching bytes through the daemon client and rendering them with loading state and Lightbox zoom.
- `git/image-diff-preview`: Renders visual Before/After image diff cards for modified, added, and deleted image files in Git Diff, backed by a gated daemon Git blob reading RPC.

### Modified Capabilities

<!-- None: newly introduced capabilities on clean OpenSpec root -->

## Impact

- `packages/protocol`: New `workspace.git.blob.request` and `workspace.git.blob.response` schemas; capability flag in server info.
- `packages/server`: Git blob reader service executing `git cat-file -p <ref>:<path>` with strict size and path validation.
- `packages/client`: DaemonClient method `readGitBlob(cwd, ref, path)`.
- `packages/app`:
  - `packages/app/src/file-pane/markdown-preview/`: Inject file location, base directory, and resolver to Markdown renderer.
  - `packages/app/src/git/`: `ImageDiffCard` component integrated into diff file rows.
