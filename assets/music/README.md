# DTAM soundtrack assets

Each soundtrack entry is a basename in `manifest.json`.

For a track named `夜航`, Pages serves:

- `/assets/music/夜航.mov` — the loopable soundtrack media.
- `/assets/music/夜航.png` — square cover art used by the in-game mini player.

The authority only synchronizes the basename, play/pause state, and timeline timestamp. Media bytes are never proxied through the realtime Server, Durable Objects, or signalling Workers.

Keep names free of `/`, `\\`, control characters, and `..`. The client URL-encodes Unicode basenames.

MOV files should use codecs supported by Chromium/WebView. AAC audio in an MP4/MOV-compatible container is the current target. Covers should be reasonably small PNG files because they are static Pages assets.

Example manifest entry:

```json
{"name":"夜航","title":"夜航"}
```
