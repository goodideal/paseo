// Polyfill crypto.randomUUID for React Native before any other imports
import { polyfillCrypto } from "./src/polyfills/crypto";
polyfillCrypto();

// Polyfill screen.orientation for WebKitGTK desktop runtimes that lack the API.
import { polyfillScreenOrientation } from "./src/polyfills/screen-orientation";
polyfillScreenOrientation();

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
import { RootApp } from "./src/root-app";

renderRootComponent(RootApp);
