import { WIDTH, HEIGHT, STATIONS, clamp } from './city';
import type { Frame } from './runtime';

export function drawRaw(canvas: HTMLCanvasElement, pixels: Uint8Array) {
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), WIDTH, HEIGHT), 0, 0);
}

export function drawDetection(canvas: HTMLCanvasElement, frame: Frame, showMask: boolean) {
  const ctx = canvas.getContext('2d')!;
  const data = new Uint8ClampedArray(frame.input.pixels);
  if (showMask) {
    frame.result.mask.forEach((value, i) => {
      if (value) {
        data[i * 4] = 255;
        data[i * 4 + 1] = 144;
        data[i * 4 + 2] = 55;
      }
    });
  }
  ctx.putImageData(new ImageData(data, WIDTH, HEIGHT), 0, 0);
  ctx.lineWidth = 1;
  ctx.font = '9px "Microsoft YaHei UI", sans-serif';
  for (const box of frame.result.detections) {
    ctx.strokeStyle = '#fc994d';
    ctx.strokeRect(box.x - box.w / 2, box.y - box.h / 2, box.w, box.h);
    const label = STATIONS[box.label].name + ' ' + Math.round(box.score * 100) + '%';
    const width = Math.ceil(ctx.measureText(label).width) + 4;
    const x = clamp(box.x - box.w / 2, 0, WIDTH - width);
    const y = clamp(box.y - box.h / 2 - 11, 0, HEIGHT - 11);
    ctx.fillStyle = '#173430';
    ctx.fillRect(x, y, width, 11);
    ctx.fillStyle = '#ffe0ad';
    ctx.fillText(label, x + 2, y + 8);
  }
}
