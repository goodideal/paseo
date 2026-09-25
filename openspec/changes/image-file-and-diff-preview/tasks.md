## 1. Protocol and Daemon Backend

- [x] 1.1 Define `workspace.git.blob.request` and `workspace.git.blob.response` in `packages/protocol/src/messages.ts` and verify with typecheck
- [x] 1.2 Implement Git blob reader service and RPC handler in `packages/server` with 5MB ceiling and path traversal guards, verifying with unit tests
- [x] 1.3 Add `gitImageDiff: true` to server info features in `packages/server` and verify capabilities payload

## 2. Client SDK

- [x] 2.1 Add `readGitBlob(cwd, ref, path)` method in `packages/client/src/daemon-client.ts` and verify build declarations

## 3. Markdown Relative Image Resolution

- [x] 3.1 Implement Markdown image path resolver utility resolving relative paths against document directory and verify with unit tests
- [x] 3.2 Update `FileMarkdownPreview` and `MarkdownRenderer` to support local workspace image resolution with skeleton loader and Lightbox, verifying with unit tests

## 4. Git Diff Image Visualization

- [x] 4.1 Implement `ImageDiffCard` with 2-Up Side-by-Side comparison, checkerboard background, file dimensions/size delta, and mobile responsive stacking
- [x] 4.2 Integrate `ImageDiffCard` into `packages/app/src/git` file presentation for image diffs when `features.gitImageDiff` is active, verifying with unit tests

## 5. Verification and Review

- [x] 5.1 Run targeted vitest suites for protocol, server, client, and app
- [x] 5.2 Perform code review using gemini-pro subagent and apply fixes
