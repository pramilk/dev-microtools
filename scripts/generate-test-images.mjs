// One-off generator for test-assets/sample-images/ — not part of the build, run manually with
// `node scripts/generate-test-images.mjs` if the sample set ever needs regenerating.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const outDir = path.join(process.cwd(), 'test-assets', 'sample-images');
await mkdir(outDir, { recursive: true });

/**
 * Writes a minimal uncompressed 24-bit BMP — sharp/libvips has no BMP encoder, and BMP is a
 * real format the Image Compressor accepts (validateImageFile only rejects GIF and SVG by
 * name; everything else, including BMP, is handled by the browser's own `createImageBitmap`).
 * BMP stores rows bottom-to-top, BGR byte order, each row padded to a 4-byte boundary.
 */
function encodeBmp(width, height, pixelAt) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileSize = 54 + pixelDataSize;
  const buf = Buffer.alloc(fileSize);

  buf.write('BM', 0, 'ascii');
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10); // pixel data offset
  buf.writeUInt32LE(40, 14); // DIB header size
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); // color planes
  buf.writeUInt16LE(24, 28); // bits per pixel
  buf.writeUInt32LE(pixelDataSize, 34);

  for (let y = 0; y < height; y++) {
    // BMP rows are stored bottom-to-top.
    const srcY = height - 1 - y;
    const rowOffset = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelAt(x, srcY);
      const o = rowOffset + x * 3;
      buf[o] = b;
      buf[o + 1] = g;
      buf[o + 2] = r;
    }
  }
  return buf;
}

function noiseBuffer(width, height, channels) {
  const buffer = Buffer.alloc(width * height * channels);
  for (let i = 0; i < buffer.length; i += channels) {
    buffer[i] = Math.floor(Math.random() * 256);
    buffer[i + 1] = Math.floor(Math.random() * 256);
    buffer[i + 2] = Math.floor(Math.random() * 256);
    if (channels === 4) buffer[i + 3] = 255;
  }
  return buffer;
}

// 1. Large smooth gradient — low entropy, compresses very well, good for exercising Max
// dimension downscaling (well above typical web sizes).
await sharp({
  create: { width: 2400, height: 1600, channels: 3, background: { r: 60, g: 188, b: 212 } },
})
  .composite([
    {
      input: await sharp({
        create: { width: 2400, height: 1600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .png()
        .toBuffer(),
      blend: 'over',
    },
  ])
  .linear(1, 0)
  .jpeg({ quality: 95 })
  .toFile(path.join(outDir, 'gradient-large.jpg'));

// 2. High-entropy "noise photo" — worst case for compression, useful for checking the tool
// handles a file that *doesn't* shrink much (or grows) without breaking.
await sharp(noiseBuffer(1600, 1200, 3), { raw: { width: 1600, height: 1200, channels: 3 } })
  .jpeg({ quality: 90 })
  .toFile(path.join(outDir, 'noise-photo.jpg'));

// 3. Transparent PNG icon — a circle on a transparent background, for checking alpha is
// preserved through the canvas + Oxipng pipeline (PNG output) and correctly flattened for
// JPEG output (which has no alpha channel).
const iconSize = 512;
const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="${iconSize}" height="${iconSize}">
  <circle cx="${iconSize / 2}" cy="${iconSize / 2}" r="${iconSize / 2 - 20}" fill="#7c5cff" fill-opacity="0.85" />
</svg>`;
await sharp(Buffer.from(svgIcon)).png().toFile(path.join(outDir, 'transparent-icon.png'));

// 4. Mid-size gradient WebP — a typical "hero image" size/format combination.
await sharp({
  create: { width: 1200, height: 800, channels: 3, background: { r: 124, g: 92, b: 255 } },
})
  .webp({ quality: 90 })
  .toFile(path.join(outDir, 'gradient.webp'));

// 5. Tiny icon — already small, checks the tool doesn't do anything strange (or upscale) when
// Max dimension exceeds the image's own size.
await sharp({
  create: { width: 64, height: 64, channels: 3, background: { r: 13, g: 17, b: 23 } },
})
  .png()
  .toFile(path.join(outDir, 'tiny-icon.png'));

// 6. AVIF — a modern format the tool accepts as input (browsers decode it via
// createImageBitmap) but doesn't offer as an output choice, so this is purely for testing the
// upload/decode side with a format outside the three the tool itself produces.
await sharp({
  create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 209, b: 102 } },
})
  .avif({ quality: 80 })
  .toFile(path.join(outDir, 'sample.avif'));

// 7. BMP — see encodeBmp() above for why this is hand-rolled instead of going through sharp.
const bmpSize = 200;
const bmp = encodeBmp(bmpSize, bmpSize, (x, y) => [
  Math.floor((x / bmpSize) * 255),
  Math.floor((y / bmpSize) * 255),
  180,
]);
await writeFile(path.join(outDir, 'sample.bmp'), bmp);

console.log('Generated sample images in', outDir);
