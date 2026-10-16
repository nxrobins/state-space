# Rock texture provenance

`rock-textures.ts` embeds the unmodified 1024×1024 JPEG diffuse, OpenGL normal
and roughness maps from **Rock Boulder Dry**, photographed by Dimitrios Savva
and processed by Rico Cilliers for Poly Haven.

- Asset: https://polyhaven.com/a/rock_boulder_dry
- License: CC0 1.0, https://polyhaven.com/license
- Downloaded October 15, 2026. The SDK needs no runtime external connection.
- Mip levels are generated at initialization; sRGB decoding applies only to
  the diffuse map. Normals and roughness remain linear data.

Files under `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/rock_boulder_dry/`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| rock_boulder_dry_diff_1k.jpg | 859211 | 20f653a42fb24f42aa40641663070d578678da49af18cc1049dbdd4ed8679f3c |
| rock_boulder_dry_nor_gl_1k.jpg | 802497 | 5915fea28a97357c78a04fb31c2516f1f7ed1b3a9cef4ae25aa93e4655e6c595 |
| rock_boulder_dry_rough_1k.jpg | 668127 | cc5229dd6bbdc4e817cb647e60242224b8e4f0237473ac018861ea243f2e8130 |

The source bytes are encoded directly as data URLs, without image modification.
The renderer applies its own rock tint, material response and physical-state
wetness. Three full mip chains occupy approximately 16 MiB on the GPU.
