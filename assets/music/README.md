# DTAM soundtrack assets

Do not hand-edit `manifest.json`. Cloudflare Pages runs `scripts/generate-music-manifest.cjs` on every build and scans this directory automatically.

To add a track, upload an audio file here. A cover with the same basename is optional:

```text
assets/music/
├─ 夜航.mov
├─ 夜航.png
├─ My Song.mp3
└─ My Song.webp
```

Supported audio extensions, in preference order when the same basename exists more than once:

- `.m4a`
- `.mp3`
- `.mov`
- `.mp4`
- `.webm`
- `.ogg`

Supported cover extensions are `.png`, `.webp`, `.jpg`, and `.jpeg`. If no matching cover exists, the track is still added and the player simply has no cover.

The build writes a schema-2 manifest containing the encoded static asset paths. Media bytes are served directly by Pages/CDN and never pass through the realtime Server, Durable Objects, or signalling Workers.

Keep basenames at 80 characters or fewer and avoid `..`, slashes, backslashes, and control characters.
