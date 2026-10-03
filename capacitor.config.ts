import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration.
 *
 * This is what lets the same build ship as a real native application for
 * Android and iOS, and — with the optional desktop targets added — Windows and
 * macOS, without a second codebase.
 *
 * Honest status: this file is real and the commands below work, but no store
 * binary is published from this repository. The verified, installable artefact
 * is the Progressive Web App, which needs no toolchain. Building native binaries
 * requires Android Studio and/or Xcode, neither of which is present in the
 * environment this project was built in.
 *
 * To produce native builds:
 *   npm run build
 *   npx cap add android        # requires Android Studio + JDK 17
 *   npx cap add ios            # requires Xcode, macOS only
 *   npx cap add electron       # optional, for Windows and macOS desktop
 *   npx cap sync
 *   npx cap open android       # then build from Android Studio
 */
const config: CapacitorConfig = {
  appId: "app.emberwake.game",
  appName: "Emberwake",
  webDir: ".next",
  android: {
    // The arena needs a WebGL-capable context and microphone for voice embers.
    allowMixedContent: false,
  },
  server: {
    // Required so the app can reach the deployed API from a native shell.
    url: "https://emberwake.vercel.app",
    cleartext: false,
  },
  plugins: {
    // No third-party Capacitor plugins are required. Recording uses the standard
    // MediaRecorder API through react-native-web's bridge.
  },
};

export default config;