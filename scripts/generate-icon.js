const sharp = require('sharp');
const toIco = require('to-ico');
const fs = require('fs');
const path = require('path');

async function main() {
  const svgPath = path.join(__dirname, '..', 'public', 'logo.svg');
  const icoPath = path.join(__dirname, '..', 'public', 'icon.ico');
  const sizes = [16, 32, 48, 64, 128, 256];

  const pngBuffers = [];
  for (const size of sizes) {
    const buf = await sharp(svgPath)
      .resize(size, size)
      .png()
      .toBuffer();
    pngBuffers.push(buf);
  }

  const icoBuf = await toIco(pngBuffers);
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`Icon created: ${icoPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
