# DTAM Android client

Optional Android wrapper for the canonical DTAM web game.

- Package: `uk.lunarlab.dtam`
- minSdk 26 / targetSdk 35
- Uses the system Android WebView; the APK intentionally does not bundle Chromium.
- Loads only the canonical game at `https://d1.lunarlab.uk/` inside the app.
- Supports `https://d1.lunarlab.uk/...` app links and `dtam://join?room=45` room deep links.
- WebRTC microphone permission is granted only for the trusted `d1.lunarlab.uk` origin and only after Android runtime permission is granted.
- Cleartext traffic, mixed content, WebView file access, and WebView content-provider access are disabled.

## Build

Run `scripts/build-android.ps1`. The script uses the installed Android SDK/JDK command-line tools directly: `aapt2`, `javac`, `d8`, `zipalign`, and `apksigner`. It does not require Android Gradle Plugin or Android Studio.

Release signing material is deliberately stored outside the repository in the maintainer user's private profile and must never be committed.

## Updates

v3.0.1+ checks `https://update.lunarlab.uk/latest.json`, downloads a newer APK only from `update.lunarlab.uk`, checks the declared size and SHA-256, and then passes the verified APK to Android `PackageInstaller`.

A normal sideloaded Android app cannot silently replace itself. If Android requires “install unknown apps” authorization or an installation confirmation, DTAM opens the corresponding system UI instead of trying to bypass it. Update failures do not block the web game.
