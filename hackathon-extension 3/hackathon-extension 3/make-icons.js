// Generates proper PNG icons without any dependencies
// Uses raw PNG encoding

const fs = require('fs');
const zlib = require('zlib');

function createPNG(size) {
  const width = size;
  const height = size;

  // Create RGBA pixel data
  const pixels = Buffer.alloc(width * height * 4);

  const cx = width / 2;
  const cy = height / 2;
  const cornerR = size * 0.22;

  // Rounded rect check
  function inRoundedRect(x, y) {
    // Check if point is inside rounded rectangle
    if (x >= cornerR && x <= width - cornerR) return true;
    if (y >= cornerR && y <= height - cornerR) return true;

    // Check corners
    const corners = [
      [cornerR, cornerR],
      [width - cornerR, cornerR],
      [cornerR, height - cornerR],
      [width - cornerR, height - cornerR]
    ];

    for (const [ccx, ccy] of corners) {
      const dx = x - ccx;
      const dy = y - ccy;
      if (dx * dx + dy * dy <= cornerR * cornerR) return true;
    }
    return false;
  }

  // Simple "C" shape detection using geometry
  function inLetterC(x, y) {
    const letterCx = cx;
    const letterCy = cy + size * 0.01;
    const outerR = size * 0.28;
    const innerR = size * 0.16;

    const dx = x - letterCx;
    const dy = y - letterCy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Ring shape
    if (dist > outerR || dist < innerR) return false;

    // Open on the right side (cut out a gap for the "C" opening)
    const angle = Math.atan2(dy, dx);
    if (angle > -0.6 && angle < 0.6) return false;

    return true;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      if (!inRoundedRect(x + 0.5, y + 0.5)) {
        // Transparent
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Gradient from indigo to purple
      const t = (x + y) / (width + height);
      const r = Math.round(79 + t * (124 - 79));
      const g = Math.round(70 + t * (58 - 70));
      const b = Math.round(229 + t * (237 - 229));

      if (inLetterC(x + 0.5, y + 0.5)) {
        // White letter
        pixels[idx] = 255;
        pixels[idx + 1] = 255;
        pixels[idx + 2] = 255;
        pixels[idx + 3] = 255;
      } else {
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }
  }

  // Encode as PNG
  return encodePNG(width, height, pixels);
}

function encodePNG(width, height, pixels) {
  // PNG file structure
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT: filter + compress pixel rows
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (1 + width * 4);
    rawData[rowOffset] = 0; // No filter
    pixels.copy(rawData, rowOffset + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(rawData);

  // Build chunks
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([len, typeBuffer, data, crc]);
  }

  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 for PNG
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Generate all sizes
[16, 48, 128].forEach(size => {
  const png = createPNG(size);
  fs.writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Created icon${size}.png (${png.length} bytes)`);
});
