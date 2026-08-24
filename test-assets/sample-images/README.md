# Sample images

Real (generated, not stock) image files for manually testing the Image Compressor — drag any
of these onto the tool instead of relying only on its synthetic "Load example" gradient.

Not part of the site build or the Vitest suite; nothing under `test-assets/` is imported by
`src/` or served from `public/`. Regenerate with `node scripts/generate-test-images.mjs`
(requires the `sharp` devDependency).

| File                    | Format | Notes                                                              |
| ------------------------ | ------ | -------------------------------------------------------------------- |
| `gradient-large.jpg`    | JPEG   | 2400×1600, smooth low-entropy gradient — compresses well; large enough to exercise Max dimension downscaling. |
| `noise-photo.jpg`       | JPEG   | 1600×1200, random noise — worst case for compression, checks the tool handles a file that barely shrinks (or grows) without breaking. |
| `transparent-icon.png`  | PNG    | 512×512 circle with alpha transparency — checks alpha survives PNG output and is correctly flattened for JPEG/WebP output. |
| `gradient.webp`         | WebP   | 1200×800 — typical "hero image" size/format.                        |
| `tiny-icon.png`         | PNG    | 64×64 — already small; checks Max dimension doesn't upscale when the cap exceeds the image's own size. |
| `sample.avif`           | AVIF   | 800×600 — a format the tool accepts as *input* (browser-decoded) but never offers as an output choice. |
| `sample.bmp`            | BMP    | 200×200 — another accepted-but-not-offered input format; hand-encoded since sharp/libvips has no BMP encoder. |
