# DTAM Windows client

Optional Windows x64 launcher for the canonical online DTAM game.

- Requires Microsoft Edge.
- The published launcher is a self-contained .NET 8 single EXE; no separate .NET runtime installation is required.
- Double-click `DTAM.exe` to open `https://d1.lunarlab.uk/` in Edge app mode.
- `DTAM.exe 45` opens room 45 directly.
- The web version remains the canonical client; the launcher does not replace DTAM's WebRTC/Server transport with a separate native game implementation.

## Updates

v3.0.1+ checks `https://update.lunarlab.uk/latest.json` after the game has already been launched. An update therefore cannot block normal startup.

When a newer Windows version is available, the launcher downloads the replacement EXE only from `update.lunarlab.uk`, verifies the advertised size and SHA-256, then schedules a replacement after the current updater process exits. Any download, parse, hash, or replacement failure leaves the current executable untouched.

The background updater mode is internal and should not normally be invoked manually.
