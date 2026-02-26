// Run this with Node.js to generate placeholder PNG icons
// Usage: node generate-icons.js
// Requires: npm install canvas (or just use any image editor)

const fs = require('fs');

// Simple 1-pixel PNG generator for placeholder icons
// These are minimal valid PNGs with the "C" branding color

function createPlaceholderPNG(size) {
  // Create a simple PNG with a gradient purple background
  // This is a minimal approach - replace with real icons for production

  const { createCanvas } = require('canvas');
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Background - rounded rect with gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#4a6cf7');
  gradient.addColorStop(1, '#6366f1');

  // Draw rounded rect
  const r = size * 0.2;
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(size - r, 0);
  ctx.quadraticCurveTo(size, 0, size, r);
  ctx.lineTo(size, size - r);
  ctx.quadraticCurveTo(size, size, size - r, size);
  ctx.lineTo(r, size);
  ctx.quadraticCurveTo(0, size, 0, size - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // "C" letter
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${size * 0.6}px -apple-system, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', size / 2, size / 2 + size * 0.03);

  return canvas.toBuffer('image/png');
}

// Try to generate with canvas, otherwise create minimal placeholders
try {
  [16, 48, 128].forEach(size => {
    const buffer = createPlaceholderPNG(size);
    fs.writeFileSync(`icons/icon${size}.png`, buffer);
    console.log(`Created icon${size}.png`);
  });
} catch (e) {
  console.log('canvas package not available. Creating minimal placeholder PNGs...');
  console.log('To get proper icons, either:');
  console.log('  1. npm install canvas && node generate-icons.js');
  console.log('  2. Create 16x16, 48x48, 128x128 PNG icons manually');
  console.log('  3. Use any online icon generator');

  // Create minimal valid 1x1 purple PNGs as placeholders
  // These are valid PNG files that Chrome will accept
  const minimalPNG = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xD7, 0x63, 0x98, 0x89, 0x61, 0x00,
    0x00, 0x00, 0x14, 0x00, 0x01, 0x14, 0xC4, 0x58,
    0xA5, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, // IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  [16, 48, 128].forEach(size => {
    fs.writeFileSync(`icons/icon${size}.png`, minimalPNG);
    console.log(`Created placeholder icon${size}.png (1x1 pixel - replace with real icons)`);
  });
}
