## Context

See proposal.md - Why.
In Paseo, `packages/server` hosts the daemon managing workspace files and Git operations. `packages/protocol` defines the backward-compatible typed WebSocket schema. `packages/client` wraps the protocol into typed promises/observables. `packages/app` renders the React Native (Expo) mobile + web interface.

## Goals / Non-Goals

**Goals:**

- Enable resolution and visual rendering of relative local images in `FileMarkdownPreview`.
- Support tap-to-expand Lightbox zoom for Markdown images.
- Provide a clean 2-Up Side-by-Side (and mobile-stacked) Before/After visual comparison card in Git Diff for image files.
- Introduce `workspace.git.blob.request` RPC with strict 5MB size limits and traversal guards.
- Gate Git Image Diff with `features.gitImageDiff` so old daemons fall back gracefully.

**Non-Goals:**

- Interactive swipe sliders or onion-skin opacity overlays (avoiding gesture collisions with horizontal scroll and mobile back gestures).
- Editing or drawing on images.
- Full PDF or video diffing.

## Decisions

### Decision 1: Dedicated Dotted RPC `workspace.git.blob.request` instead of mutating `readFile`

- _Rationale_: Mutating the existing flat `readFile` RPC would break protocol conventions and cause silent fallback to the current working tree on older daemons. A dedicated dotted RPC `workspace.git.blob.request` guarantees explicit semantics.
- _Alternatives Considered_: Extending `readFile(cwd, path, gitRef)` — rejected due to backward compatibility risks and silent bugs.

### Decision 2: 2-Up Side-by-Side & Mobile Stacking instead of Swipe Slider

- _Rationale_: Diff views already require horizontal scrolling for wide content, and mobile devices reserve edge swipes for navigation. A static 2-Up comparison with dimensions, file size, and percentage change indicator provides clear verification without gesture conflicts.
- _Alternatives Considered_: Swipe divider — rejected due to touch gesture conflicts.

### Decision 3: Contextual URL Resolver for Markdown Images

- _Rationale_: `FilePane` knows the active file path (e.g. `docs/sub/readme.md`). Passing `baseDir` to `FileMarkdownPreview` allows resolving `./pic.png` into `docs/sub/pic.png` and fetching bytes via `client.readFile` and `persistAttachmentFromBytes`.
- _Alternatives Considered_: Webview iframe rendering — rejected because native mobile and desktop require cohesive styling, zoom gestures, and theme token integration.

### Decision 4: Safe SVG Rendering via `<img>` on Web and Safe Fallback on Native

- _Rationale_: To prevent XSS vulnerabilities, SVG images on Web/Electron must render strictly via `<img>` tags (which disable script execution) rather than inline `<svg dangerouslySetInnerHTML>`. On Native React Native, display an SVG icon or safe fallback card.

## Risks / Trade-offs

- [Risk: Large image memory pressure on React Native bridge] → Daemon enforces a 5MB payload ceiling per image. Blobs exceeding this return `status: "too_large"` with metadata instead of raw bytes.
- [Risk: Directory traversal attack e.g. `../../etc/passwd`] → Daemon canonicalizes paths using `resolveScopedPath` and validates that the resolved path starts with the workspace root.
- [Risk: Git rename changes paths between Before and After] → The resolver inspects `change.oldPath` for the Before blob and `change.path` for the After blob.
