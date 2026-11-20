import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// Isolate Session.run from segmentation, tracking, browser scheduling and readback.
export async function profileNetwork(page) {
  const source = [
    "import * as ort from 'onnxruntime-web/wasm';",
    "ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=new URL('./runtime/',self.location.href).href;",
    'self.onmessage=async({data})=>{try{',
    "const model=await ort.InferenceSession.create('./models/mature.onnx',{executionProviders:['wasm']});",
    'const values=Float32Array.from(atob(data),c=>c.charCodeAt(0)/255);',
    "const input=new ort.Tensor('float32',values,[1,1,24,24]);",
    'async function forward(){const output=await model.run({image:input});output.logits.dispose();}',
    'for(let i=0;i<30;i++)await forward();const blocks=[];',
    'for(let b=0;b<25;b++){const start=performance.now();for(let i=0;i<40;i++)await forward();blocks.push((performance.now()-start)/40);}',
    'input.dispose();await model.release();self.postMessage({forwards:1000,meanMs:blocks.reduce((a,b)=>a+b,0)/blocks.length,blockMeanP95Ms:blocks.sort((a,b)=>a-b)[23]});',
    '}catch(error){self.postMessage({error:String(error)});}};',
  ].join('\n');
  const bundle = await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    format: 'esm',
    bundle: true,
    write: false,
    minify: true,
    target: 'es2022',
    legalComments: 'none',
  });
  await page.route('**/model-profile.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text })
  );
  const data = JSON.parse(gunzipSync(await readFile('Vision/data/roof-crops.json.gz')));
  const crop = data.rows.find((r) => r.split === 'test' && r.id === 1).crop;
  return page.evaluate(
    (crop) =>
      new Promise((resolve, reject) => {
        const worker = new Worker('./model-profile.js', { type: 'module' });
        worker.onmessage = ({ data }) => {
          worker.terminate();
          if (data.error) reject(Error(data.error));
          else resolve(data);
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(Error(e.message));
        };
        worker.postMessage(crop);
      }),
    crop
  );
}
// Geometry is used by this offline evaluator after a frame has gone through the normal worker.
export async function evaluateVision(page) {
  return page.evaluate(async () => {
    const g = window.aeromind;
    g.verifiedMode = true;
    await g.pending;
    let positives = 0,
      tp = 0,
      fp = 0,
      occluded = 0,
      onCovered = 0,
      boxIoU = 0,
      maskIoU = 0,
      centerError = 0,
      trackPairs = 0,
      stable = 0;
    for (const seed of [701, 719, 733, 751]) {
      g.reset({ ...g.sim.s.config, mode: '课程', chapter: 2, seed, model: 'mature', fleet: 1 });
      await new Promise((yes, no) => {
        let tries = 0;
        const id = setInterval(() => {
          if (
            g.view.cityRoot.children
              .filter((x) => x.material?.map)
              .every((x) => x.material.map.image?.complete)
          ) {
            clearInterval(id);
            yes();
          } else if (++tries > 400) {
            clearInterval(id);
            no(Error('texture loading failed'));
          }
        }, 12);
      });
      const d = g.sim.s.drones[0];
      for (let label = 0; label < 5; label++) {
        let last = null;
        for (let n = 0; n < 8; n++) {
          const fixture = g.sim.city.fixtures[label],
            cover = n >= 6;
          g.sim.s.time += 0.24;
          g.sim.s.events = [];
          if (cover)
            g.sim.place('occupied', Math.round(fixture.x / 6) + 5, Math.round(fixture.z / 6) + 4, 0, 4);
          g.sim.extra = g.sim.city.obstacles(g.sim.s.events, g.sim.s.time);
          d.p = {
            x: fixture.x + Math.sin(n * 0.48) * 0.7,
            y: fixture.y + 6.2 + n * 0.31,
            z: fixture.z + 0.51 * Math.cos(n * 0.52),
          };
          g.sim.s.config.weather = ['晴朗', '小雨', '薄雾', '夜航'][n % 4];
          g.view.render();
          await g.sample(0);
          const f = g.frames.get(0);
          if (!f || Math.abs(f.input.sample - g.sim.s.time) > 0.01)
            throw Error('Missing rendered evaluation frame');
          const hits = f.result.detections;
          if (cover) {
            occluded++;
            onCovered += hits.filter((b) => b.label === label).length;
            fp += hits.length;
            continue;
          }
          positives++;
          const scale = (2 * (d.p.y + 0.12 - fixture.y - 0.29) * Math.tan((65 * Math.PI) / 360)) / 144;
          const x = 96 + (fixture.x - d.p.x) / scale,
            y = 72 + (fixture.z - d.p.z) / scale,
            w = 3.24 / scale;
          const good = hits
            .filter((b) => b.label === label)
            .map((b) => {
              const q =
                Math.max(0, Math.min(x + w / 2, b.x + b.w / 2) - Math.max(x - w / 2, b.x - b.w / 2)) *
                Math.max(0, Math.min(y + w / 2, b.y + b.h / 2) - Math.max(y - w / 2, b.y - b.h / 2));
              return { b, iou: q / (w * w + b.w * b.h - q) };
            })
            .sort((a, b) => b.iou - a.iou)[0];
          let intersection = 0,
            union = 0;
          for (let j = Math.max(0, Math.floor(y - w / 2) - 1); j < Math.min(144, y + w / 2 + 1); j++)
            for (let i = Math.max(0, Math.floor(x - w / 2) - 1); i < Math.min(192, x + w / 2 + 1); i++) {
              const radius = Math.max(Math.abs(i + 0.5 - x), Math.abs(j + 0.5 - y)) / w;
              const wanted = radius <= 0.5 && radius > 0.5 - 9 / 96,
                found = f.result.mask[j * 192 + i] === 1;
              if (wanted || found) union++;
              if (wanted && found) intersection++;
            }
          maskIoU += intersection / Math.max(1, union);
          if (good && good.iou >= 0.5) {
            tp++;
            boxIoU += good.iou;
            centerError += Math.hypot(x - good.b.x, y - good.b.y);
            if (last !== null) {
              trackPairs++;
              if (last === good.b.track) stable++;
            }
            last = good.b.track;
            fp += hits.length - 1;
          } else {
            fp += hits.length;
            last = null;
          }
        }
      }
    }
    return {
      seeds: [701, 719, 733, 751],
      positives,
      occluded,
      truePositives: tp,
      falsePositives: fp,
      recall: tp / positives,
      precision: tp / Math.max(1, tp + fp),
      coveredFalseDetections: onCovered,
      meanBoxIoU: boxIoU / Math.max(1, tp),
      meanBorderMaskIoU: maskIoU / positives,
      meanCentroidErrorPixels: centerError / Math.max(1, tp),
      stableTrackPairs: stable,
      trackPairs,
    };
  });
}
