import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

// Offline annotator only. Geometric labels never enter the running vision worker.
export async function collect(page) {
  const splits = {
    train: [101, 113, 127, 149, 163, 179, 193, 211],
    validation: [307, 331, 353],
    test: [503, 521, 541, 563],
  };
  const rows = [];
  for (const [split, seeds] of Object.entries(splits))
    for (const seed of seeds) {
      const samples = await page.evaluate(async (seed) => {
        const g = window.aeromind;
        g.verifiedMode = true;
        await g.pending;
        g.reset({ ...g.sim.s.config, seed, chapter: 2, fleet: 1 });
        await Promise.all(
          g.view.cityRoot.children
            .filter((x) => x.material?.map)
            .map(async (mesh) => {
              const img = mesh.material.map.image;
              if (!img || !img.complete)
                await new Promise((yes, no) => {
                  const start = performance.now();
                  const timer = setInterval(() => {
                    if (mesh.material.map.image?.complete) {
                      clearInterval(timer);
                      yes();
                    } else if (performance.now() - start > 5000) {
                      clearInterval(timer);
                      no(Error('Sign texture not loaded'));
                    }
                  }, 12);
                });
            })
        );
        const samples = [],
          d = g.sim.s.drones[0],
          weather = ['晴朗', '薄雾', '夜航', '小雨'];
        const encode = (raw, cx, cy, side) => {
          const out = new Uint8Array(24 * 24);
          for (let y = 0; y < 24; y++)
            for (let x = 0; x < 24; x++) {
              const ix = Math.max(0, Math.min(191, Math.floor(cx + ((x + 0.5) / 24 - 0.5) * side)));
              const iy = Math.max(0, Math.min(143, Math.floor(cy + ((y + 0.5) / 24 - 0.5) * side))),
                p = (iy * 192 + ix) * 4;
              out[y * 24 + x] = (raw[p] * 77 + raw[p + 1] * 150 + raw[p + 2] * 29) >> 8;
            }
          return btoa(String.fromCharCode(...out));
        };
        for (let id = 0; id < 5; id++)
          for (let shot = 0; shot < 10; shot++) {
            const f = g.sim.city.fixtures[id],
              alt = 4.6 + shot * 0.83,
              a = (seed + shot * 2.3) * 1.73;
            d.p = { x: f.x + Math.cos(a) * alt * 0.19, y: f.y + alt, z: f.z + Math.sin(a) * alt * 0.21 };
            g.sim.s.config.weather = weather[shot % 4];
            g.view.render();
            const rgb = g.view.capture(0);
            const slope = (2 * (d.p.y + 0.12 - f.y - 0.29) * Math.tan((65 * Math.PI) / 360)) / 144;
            const cx = 96 + (f.x - d.p.x) / slope,
              cy = 72 + (f.z - d.p.z) / slope,
              w = 3.24 / slope;
            samples.push({
              id,
              shot,
              weather: weather[shot % 4],
              crop: encode(rgb, cx, cy, w * (0.97 + (shot % 3) * 0.035)),
            });
            if (shot % 4 === 0)
              samples.push({
                id: 5,
                shot,
                weather: weather[shot % 4],
                crop: encode(rgb, 22 + (id % 2) * 142, 22 + (shot % 2) * 93, 24),
              });
          }
        return samples;
      }, seed);
      rows.push(...samples.map((s) => ({ ...s, seed, split })));
    }
  await mkdir('Vision/data', { recursive: true });
  await writeFile(
    'Vision/data/roof-crops.json.gz',
    gzipSync(JSON.stringify({ size: 24, splits, rows }), { level: 9 })
  );
  return { splits, count: rows.length };
}
