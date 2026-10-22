// Install runtime polyfills before any other module evaluates. Keep this the first import.
// oxlint-disable-next-line import/no-unassigned-import -- Polyfills install on import.
import "./src/polyfills/install-early";

// Polyfill ES2023 array methods (findLast, findLastIndex, toReversed, toSorted, etc.)
// for web runtimes that lack the APIs.
import { polyfillArray } from "./src/polyfills/array";
polyfillArray();

// Configure Unistyles before Expo Router pulls in any components using StyleSheet.
import "./src/styles/unistyles";
// oxlint-disable-next-line import/no-unassigned-import -- Preserve Expo's entry side effects.
import "@expo/metro-runtime";
// oxlint-disable-next-line import/no-unassigned-import -- Preserve Expo's entry side effects.
import "expo-router/build/fast-refresh";
import { renderRootComponent } from "expo-router/build/renderRootComponent";
import { startWatchdog } from "./src/watchdog";
import { RootApp } from "./src/root-app";

startWatchdog();
renderRootComponent(RootApp);
