// Renders resources/installer/loading.gif, the animation Squirrel.Windows shows while
// ReplayEnglish-Setup.exe installs (MakerSquirrel `loadingGif` in forge.config.ts).
// Like build-icon.cjs, Chromium draws the frames; ffmpeg-static encodes them. Run with
//   npx electron scripts/build-loading-gif.cjs
// GIF has no partial transparency, so the frame is an opaque rounded card on the app's
// slate background.
const { app, BrowserWindow } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'resources', 'installer', 'loading.gif');
const WIDTH = 420;
const HEIGHT = 260;
const FPS = 25;
const FRAMES = 50; // a 2 s seamless loop

function drawFrame(win, svg, frame) {
  return win.webContents.executeJavaScript(`
    (async () => {
      const W = ${WIDTH}, H = ${HEIGHT}, t = ${frame / FRAMES};
      if (!window.icon) {
        window.icon = new Image();
        window.icon.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
        await window.icon.decode();
        await document.fonts.load('600 22px "Segoe UI"');
      }
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const TAU = Math.PI * 2;

      // Card: slate-900 with a faint blue glow behind the icon.
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W, H);
      const glow = ctx.createRadialGradient(W / 2, 92, 0, W / 2, 92, 150);
      glow.addColorStop(0, 'rgba(59,130,246,0.28)');
      glow.addColorStop(1, 'rgba(59,130,246,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Icon, breathing gently.
      const size = 92 * (1 + 0.035 * Math.sin(t * TAU));
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(window.icon, (W - size) / 2, 92 - size / 2, size, size);

      // Audio-level bars either side of the icon, each on its own phase.
      ctx.fillStyle = '#34d399';
      for (const side of [-1, 1]) {
        for (let i = 0; i < 4; i++) {
          const h = 8 + 26 * (0.5 + 0.5 * Math.sin(t * TAU * 2 + i * 1.3 + (side > 0 ? 0.7 : 0)));
          const x = W / 2 + side * (70 + i * 13) - 3;
          ctx.globalAlpha = 1 - i * 0.2;
          ctx.beginPath();
          ctx.roundRect(x, 92 - h / 2, 6, h, 3);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      ctx.textAlign = 'center';
      ctx.fillStyle = '#f1f5f9';
      ctx.font = '600 22px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Replay English', W / 2, 176);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px "Segoe UI", system-ui, sans-serif';
      ctx.fillText('Installing…', W / 2, 200);

      // Indeterminate progress: a blue-to-green segment sweeping a slate track.
      const tx = 110, ty = 222, tw = W - 220, th = 4;
      ctx.fillStyle = '#1e293b';
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 2); ctx.fill();
      ctx.save();
      ctx.beginPath(); ctx.roundRect(tx, ty, tw, th, 2); ctx.clip();
      const seg = 70, x0 = tx - seg + (tw + seg) * t;
      const grad = ctx.createLinearGradient(x0, 0, x0 + seg, 0);
      grad.addColorStop(0, 'rgba(59,130,246,0)');
      grad.addColorStop(0.6, '#3b82f6');
      grad.addColorStop(1, '#34d399');
      ctx.fillStyle = grad;
      ctx.fillRect(x0, ty, seg, th);
      ctx.restore();

      return canvas.toDataURL('image/png');
    })()
  `);
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'loading-gif-'));
  try {
    const svg = fs.readFileSync(path.join(ROOT, 'resources', 'icon', 'icon.svg'), 'utf8');
    const win = new BrowserWindow({ show: false });
    await win.loadURL('about:blank');

    for (let f = 0; f < FRAMES; f++) {
      const dataUrl = await drawFrame(win, svg, f);
      const name = `frame-${String(f).padStart(3, '0')}.png`;
      fs.writeFileSync(path.join(tmp, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
    }

    // One palette for the whole loop keeps colours stable between frames.
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    execFileSync(ffmpeg, [
      '-y', '-loglevel', 'error',
      '-framerate', String(FPS),
      '-i', path.join(tmp, 'frame-%03d.png'),
      '-filter_complex', '[0:v]split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a',
      '-loop', '0',
      OUT,
    ]);

    console.log(`Wrote ${OUT} (${WIDTH}x${HEIGHT}, ${FRAMES} frames, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
    app.exit(0);
  } catch (err) {
    console.error(err);
    app.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
