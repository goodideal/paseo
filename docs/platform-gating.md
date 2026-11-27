# Platform gating

The app runs on iOS, Android, web (browser), and web (Electron desktop). Code is cross-platform by default; gate only when you must. Import platform gates from `@/constants/platform` and layout breakpoint hooks from `@/constants/layout`.

## The four gates

| Gate                       | Type      | When to use                                                                                                       |
| -------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| `isWeb`                    | constant  | DOM APIs — `document`, `window`, `<div>`, `addEventListener`, `ResizeObserver`. Exception, not the default.       |
| `isNative`                 | constant  | Native-only APIs — Haptics, `StatusBar.currentHeight`, push tokens, camera/scanner, `expo-av`.                    |
| `getIsElectron()`          | cached fn | Desktop wrapper features — file dialogs, titlebar drag region, daemon management, app updates, dock badges.       |
| `useIsCompactFormFactor()` | hook      | Layout decisions — sidebar overlay vs pinned, modal vs full screen, single-panel vs split (`@/constants/layout`). |

## Decision matrix

| I need to...                                                   | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Access DOM (`document`, `window`, `<div>`, `addEventListener`) | `if (isWeb)`                                                              |
| Use a native-only API (Haptics, push tokens, camera)           | `if (isNative)`                                                           |
| Use an Electron bridge (file dialog, titlebar, updates)        | `if (getIsElectron())`                                                    |
| Switch layout between phone and tablet/desktop                 | `useIsCompactFormFactor()`                                                |
| Show something on hover, always visible on native              | `isHovered \|\| isNative \|\| isCompact` (hover only works on web)        |
| Gate to iOS or Android specifically                            | `Platform.OS === "ios"` / `Platform.OS === "android"` (rare, keep inline) |

## Rules

- **Prefer Metro file extensions over runtime branches.** When implementations differ per platform, split into `.web.ts` / `.native.ts` so Metro strips unused platform code at build time. Reserve `if (isWeb)` for single-line checks or a few props.
  ```
  hooks/
    use-audio-recorder.web.ts    ← uses Web Audio API
    use-audio-recorder.native.ts ← uses expo-audio
  ```
  Import as `@/hooks/use-audio-recorder`.
- **Use `.electron.ts` / `.electron.tsx` for Electron-only web modules.** Desktop builds set `PASEO_WEB_PLATFORM=electron`, so Metro checks `.electron.*` before `.web.*`. Put `webviewTag`, preload bridges, and desktop-only APIs in `.electron.*`, plain browser web in `.web.*`, and native fallbacks in the base or `.native.*` file.
  ```
  desktop/browser/pane/
    index.electron.tsx ← Electron <webview> implementation
    index.web.tsx      ← plain web fallback
    index.tsx          ← native fallback
  ```
  Import as `@/desktop/browser/pane`.
- **Guard raw DOM APIs with `isWeb`.** DOM APIs crash native; casting a React Native ref to `HTMLElement` requires an `isWeb` block or a `.web.*` file.
- **Track hover with an outer `<View>` + `onPointerEnter` / `onPointerLeave` and a separate inner `<Pressable>`.** Never attach `onPointerEnter` / `onPointerLeave` directly to `<Pressable>`, and do not use `<Pressable onHoverIn/onHoverOut>` to drive external state (nested `Pressable`s steal hover state; use `<Pressable style={({ hovered }) => ...}>` only for self-contained styling). `onPointerEnter` / `onPointerLeave` are DOM events that do not fire on native iOS/Android, so they do not need an `if (isWeb)` guard. Reveal hover-only controls with `isHovered || isNative || isCompact` so touch devices always render them. See [docs/hover.md](hover.md).
- **Use breakpoints for layout, not `Platform.OS`.** Call `useIsCompactFormFactor()` instead of inferring screen size from platform.
- **Import `isWeb` and `isNative` from `@/constants/platform`.** Never write `const isWeb = Platform.OS === "web"` locally.
