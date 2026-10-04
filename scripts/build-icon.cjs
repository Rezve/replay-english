// Renders resources/icon/icon.svg to icon.png (512px) and a multi-size icon.ico.
// No image tooling is installed, so Chromium does the rasterising: run with
//   npx electron scripts/build-icon.cjs
// ICO entries are stored as PNG, which Windows Vista+ reads at every size.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'resources', 'icon');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const PNG_SIZE = 512;

async function rasterise(win, svg, size) {
  const dataUrl = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = ${size};
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, ${size}, ${size});
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('SVG failed to load'));
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })
  `);
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 means 256
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  try {
    const svg = fs.readFileSync(path.join(DIR, 'icon.svg'), 'utf8');
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');

    const pngs = [];
    for (const size of ICO_SIZES) pngs.push({ size, data: await rasterise(win, svg, size) });
    fs.writeFileSync(path.join(DIR, 'icon.ico'), buildIco(pngs));
    fs.writeFileSync(path.join(DIR, 'icon.png'), await rasterise(win, svg, PNG_SIZE));

    console.log(`Wrote icon.ico (${ICO_SIZES.join(', ')}) and icon.png (${PNG_SIZE}) to ${DIR}`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  }
});
