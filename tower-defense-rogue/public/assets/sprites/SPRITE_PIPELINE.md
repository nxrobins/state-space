# Sprite Pipeline Notes

Relic Line uses deterministic PNG strips generated from seed poses so the game can build without an external image API.

- Each character, tower, hero, and machine has a seed frame in `seed/`.
- Each runtime strip is generated as one whole strip with a fixed frame count.
- Characters use bottom-center anchoring inside 48x48 frames; towers use bottom-center inside 64x64 frames.
- `preview/preview-sheet.png` is the inspection artifact for the current asset set.
- The prompt shape for an AI edit pass would be: same silhouette family, same palette family, same facing direction, transparent background, exact frame count, crisp pixel-art clusters, no labels, no scenery.
