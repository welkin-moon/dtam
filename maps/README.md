# DTAM maps

This directory is the source-of-truth boundary for future custom maps.

`east-beach-v1.json` uses the authoritative 150 x 150 network coordinate space. New maps should keep gameplay geometry separate from artwork:

- `background`: non-colliding visual layer.
- `collision`: authoritative walls/obstacles.
- `foreground`: visual occluders drawn above characters.
- `minimap`: optional pre-rendered minimap layer.
- `gameplay.bushes`: named concealment regions. A living player inside a bush region is hidden from living viewers outside that same region. Wall/door line-of-sight still applies.
- tasks, vents, spawns and future map-specific interactables should move into this manifest when the current procedural map is replaced.

The current v1 wall grid remains generated in the three authoritative runtimes (browser authority, Rust server, and client) for compatibility. CI must keep the bush definitions synchronized with this manifest until the custom-map importer replaces those generated copies.
