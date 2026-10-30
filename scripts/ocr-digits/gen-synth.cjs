// Butuh halaman uji (index.html + bundle.js) yang memuat lib/ocr/digit-ocr.js sebagai window.segmentDigits, disajikan di port 3200.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const FONTS = ['Patrick Hand','Architects Daughter','Just Another Hand','Nothing You Could Do','Schoolbell','Neucha','Coming Soon','Handlee','Short Stack','Itim','Mali','Sriracha','Gaegu','Delius','Annie Use Your Love','Waiting for the Sunrise','Homemade Apple','Reenie Beanie','Sue Ellen Francisco','La Belle Aurore','Mansalva','Nanum Pen Script','Gloria Hallelujah','Pangolin','Chilanka','Zeyada','Kristi','Dawning of a New Day','Loved by the King','Over the Rainbow','Swanky and Moo Moo','Give You Glory','Cabin Sketch','Finger Paint','Freehand','Hi Melody','Gamja Flower','Yomogi','Klee One','Caveat Brush','Shantell Sans','Edu SA Beginner','Edu NSW ACT Foundation','Playpen Sans','Sedgwick Ave','Sedgwick Ave Display','Rancho','Walter Turncoat','Kalam','Gochi Hand'];
// catatan: Kalam & Gochi Hand ikut dilatih → evaluasi akhir pakai font lain yang tidak dilatih
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', '3200'], { cwd: __dirname, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3200/index.html');
  const ok = await page.evaluate(async (fonts) => {
    for (const f of fonts) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(f) + '&display=block'; document.head.appendChild(l); }
    await new Promise(r => setTimeout(r, 4000));
    const ok = [];
    for (const f of fonts) { try { await document.fonts.load(`80px "${f}"`, '0123456789'); if (document.fonts.check(`80px "${f}"`, '0123456789')) ok.push(f); } catch {} }
    return ok;
  }, FONTS);
  console.log('fonts ok', ok.length);
  const N = Number(process.env.N || 120);
  const chunks = [];
  for (const f of ok) {
    const r = await page.evaluate(async ({ f, N, fi }) => {
      let seed = 1000 + fi * 7919; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const X = [], Y = [];
      for (let k = 0; k < N; k++) {
        const code = String(Math.floor(rnd() * 1e10)).padStart(10, '0');
        const c = document.createElement('canvas'); c.width = 620; c.height = 170;
        const x = c.getContext('2d');
        const b = 150 + rnd() * 70;
        const gr = x.createLinearGradient(0, 0, 620, 170); gr.addColorStop(0, `rgb(${b},${b * 0.88},${b * 0.68})`); gr.addColorStop(1, `rgb(${b * 0.8},${b * 0.7},${b * 0.5})`);
        x.fillStyle = gr; x.fillRect(0, 0, 620, 170);
        for (let i = 0; i < 170; i += 5) { x.fillStyle = 'rgba(0,0,0,0.07)'; x.fillRect(0, i, 620, 2); }
        for (let i = 0; i < 620; i += 6) { x.fillStyle = 'rgba(0,0,0,0.05)'; x.fillRect(i, 0, 2, 170); }
        x.save(); x.translate(310, 90); x.rotate((rnd() - 0.5) * 0.14);
        const size = 56 + Math.floor(rnd() * 26);
        x.font = `${size}px "${f}"`; x.fillStyle = '#151515'; x.strokeStyle = '#151515'; x.textBaseline = 'middle';
        const lw = rnd() < 0.5 ? 0 : rnd() * 5; x.lineWidth = lw; x.lineJoin = 'round';
        const gap = 4 + rnd() * 10;
        const widths = code.split('').map(ch => x.measureText(ch).width + gap);
        let px = -widths.reduce((a, b) => a + b, 0) / 2;
        code.split('').forEach((ch, i) => {
          x.save(); x.translate(px + widths[i] / 2, (rnd() - 0.5) * 10); x.rotate((rnd() - 0.5) * 0.22); x.scale(0.9 + rnd() * 0.2, 0.9 + rnd() * 0.2);
          x.fillText(ch, -widths[i] / 2 + gap / 2, 0); if (lw) x.strokeText(ch, -widths[i] / 2 + gap / 2, 0); x.restore(); px += widths[i];
        });
        x.restore();
        const id = x.getImageData(0, 0, 620, 170);
        for (let i = 0; i < id.data.length; i += 4) { const n = (rnd() - 0.5) * 40; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; }
        x.putImageData(id, 0, 0);
        for (const [H, C] of [[96, 14], [128, 20]]) {
          const segs = window.segmentDigits(c, H, C);
          if (segs.length !== 10) continue;
          segs.forEach((im, i) => { X.push(Array.from(im, v => Math.round(v * 255))); Y.push(Number(code[i])); });
          break;
        }
      }
      return { X, Y };
    }, { f, N, fi: ok.indexOf(f) });
    console.log(f, r.Y.length);
    chunks.push(r);
  }
  const X = Buffer.from(chunks.flatMap(c => c.X.flat()));
  const Y = Buffer.from(chunks.flatMap(c => c.Y));
  fs.writeFileSync(__dirname + '/data/synth-x.bin', X);
  fs.writeFileSync(__dirname + '/data/synth-y.bin', Y);
  console.log('total', Y.length);
  await browser.close(); srv.kill();
})();
