import * as ort from 'onnxruntime-web/wasm';
import { classify, crop, opticalFlow, segment, shrink } from './vision';
import type { Capture, Checkpoint, Detection, Observation } from './vision-types';

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = new URL('./runtime/', self.location.href).href;
const models = new Map<Checkpoint, ort.InferenceSession>();
const histories = new Map<number, { gray: Uint8Array; detections: Detection[]; epoch: number; s: number }>();
let nextTrack = 0;
async function model(stage: Checkpoint) {
  if (!models.has(stage))
    models.set(
      stage,
      await ort.InferenceSession.create('./models/' + stage + '.onnx', {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    );
  return models.get(stage)!;
}
async function processFrame(f: Capture) {
  const start = performance.now(),
    net = await model(f.model);
  const { mask, gray, regions } = segment(f.pixels, f.width, f.height);
  let old = histories.get(f.drone);
  if (old && (old.epoch !== f.epoch || f.sample - old.s > 1.6 || f.sample < old.s)) old = undefined;
  let detections: Detection[] = [];
  if (regions.length) {
    const input = new ort.Tensor('float32', crop(gray, f.width, regions), [regions.length, 1, 24, 24]);
    const output = await net.run({ image: input });
    detections = classify(
      output.logits.data as Float32Array,
      regions,
      old?.detections ?? [],
      () => ++nextTrack
    );
    input.dispose();
    output.logits.dispose();
  }
  const small = shrink(gray, f.width, f.height),
    flow = opticalFlow(old?.gray, small, f.width / 2, f.height / 2);
  histories.set(f.drone, { gray: small, detections, epoch: f.epoch, s: f.sample });
  const result: Observation = {
    frame: f.frame,
    drone: f.drone,
    epoch: f.epoch,
    sample: f.sample,
    wall: f.wall,
    model: f.model,
    detections,
    flow,
    ms: performance.now() - start,
    candidates: regions.length,
    mask,
  };
  self.postMessage({ type: 'result', result }, { transfer: [mask.buffer] });
}
self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'init') {
      await model('mature');
      self.postMessage({ type: 'ready' });
    } else if (data.type === 'frame') await processFrame(data);
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error) });
  }
};
