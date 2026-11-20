import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, writeFile, unlink, readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { collect } from './collect.mjs';
import { scenarios } from './scenarios.mjs';
import { evaluateVision, profileNetwork } from './vision-eval.mjs';
import { classroomUI } from './classroom-ui.mjs';
import { chromium } from 'playwright-core';
const args = process.argv.slice(2),
  mode = args[0] || 'smoke',
  out = 'output/playwright';
await mkdir(out, { recursive: true });
const binary =
  process.env.AEROMIND_BROWSER ||
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
  ].find(existsSync);
if (!binary) throw Error('A local Edge/Chrome executable is required; set AEROMIND_BROWSER.');
let port = 0;
if (process.env.AEROMIND_APP) {
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, '127.0.0.1', resolve));
  port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
}
const sessionFile = path.resolve(out, '.session-' + randomUUID());
await writeFile(sessionFile, 'test');
const server = spawn(
  process.env.AEROMIND_APP || process.env.AEROMIND_PYTHON || 'python',
  [
    ...(process.env.AEROMIND_APP ? [] : ['-u', 'tools/launch.py']),
    '--port',
    String(port),
    '--no-browser',
    '--session-file',
    sessionFile,
  ],
  { windowsHide: true }
);
server.stderr.on('data', (b) => process.stderr.write(b));
const url = port
  ? 'http://127.0.0.1:' + port + '/'
  : await new Promise((resolve, reject) => {
      server.stdout.once('data', (b) => resolve(String(b).trim()));
      server.once('error', reject);
      server.once('exit', (n) => reject(Error('Host exit ' + n)));
    });
if (port) {
  let ready = false;
  for (let i = 0; i < 180 && !ready; i++) {
    try {
      ready = (await (await fetch(url + 'identity')).text()) === 'AeroMind-2.5D';
    } catch {}
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) {
    server.kill();
    throw Error('Packaged host failed to start.');
  }
}
const browser = await chromium.launch({
  executablePath: binary,
  headless: !args.includes('--headed'),
  args: [
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
  ],
});
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errors = [],
    external = [],
    page = await context.newPage();
  await context.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname !== '127.0.0.1' && !['data:', 'blob:'].includes(u.protocol)) {
      external.push(u.hostname);
      return r.abort();
    }
    return r.continue();
  });
  page.on('pageerror', (e) => {
    errors.push(e.message);
    console.error('Browser error', e.message);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') console.error(m.text());
  });
  await page.goto(url + '?verify=1');
  await page.waitForFunction(() => window.aeromind?.ready || window.aeromind?.error, null, {
    timeout: 55000,
  });
  const hardware = await page.evaluate(() => {
    const g = window.aeromind,
      gl = g.view.renderer.getContext(),
      ext = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      webgl: gl.getParameter(gl.VERSION),
      viewport: [innerWidth, innerHeight],
      drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      error: g.error,
      browser: navigator.userAgent,
    };
  });
  assert.equal(hardware.error, '');
  console.log(JSON.stringify(hardware));
  await page.waitForFunction(() => window.aeromind.frames.size > 0, null, { timeout: 20000 });
  if (mode === 'smoke' || mode === 'native') await page.screenshot({ path: out + '/' + mode + '-city.png' });
  const testedApplicationSha256=process.env.AEROMIND_APP?
    createHash('sha256').update(await readFile(process.env.AEROMIND_APP)).digest('hex'):null;
  const report = { mode, hardware, external, errors, packaged: !!process.env.AEROMIND_APP,testedApplicationSha256 };
  if (mode === 'smoke' || mode === 'standard') {
    const results = [];
    for (let i = 0; i < (mode === 'smoke' ? 1 : 10); i++) {
      const result = await page.evaluate(async (seed) => {
        const g = window.aeromind;
        g.verifiedMode = true;
        await g.pending;
        g.reset({ ...g.sim.s.config, chapter: 2, model: 'mature', mode: '课程', fleet: 1, seed });
        document.querySelector('#dispatch').click();
        for (let k = 0; k < 28 && !g.sim.s.completed.length; k++) await g.advance(5, 0.2);
        const d = g.sim.s.drones[0];
        return {
          seed,
          receipt: g.sim.s.completed[0] ?? null,
          phase: d.phase,
          p: d.p,
          pose: d.pose,
          destination: d.destination,
          route: d.route.slice(0, 4),
          signed: d.signed,
          accepted: d.accepted,
          log: g.sim.s.log.slice(-8),
          vision: d.evidence,
          dropped: g.metrics.dropped,
        };
      }, 2101 + i);
      results.push(result);
      console.log('order', i + 1, JSON.stringify(result.receipt ?? result));
    }
    report.results = results;
    await writeFile(out + '/' + mode + '.json', JSON.stringify(report, null, 2));
    assert.ok(
      results.filter((r) => r.receipt?.signed && r.receipt.result === '已签收并归港').length >=
        Math.ceil(results.length * 0.9)
    );
    assert.ok(results.every((r) => r.receipt?.collisions === 0 && r.receipt.error <= 1.5 && r.accepted > 0));
  } else if (mode === 'perception') {
    report.metrics = await evaluateVision(page);
    report.network = await profileNetwork(page);
    console.log(JSON.stringify(report.metrics));
    assert.ok(
      report.metrics.recall >= 0.85 &&
        report.metrics.precision >= 0.9 &&
        report.metrics.coveredFalseDetections === 0
    );
  } else if (mode === 'scenarios') {
    report.cases = await scenarios(page);
    await writeFile(out + '/' + mode + '.json', JSON.stringify(report, null, 2));
    assert.equal(report.cases.coveredBefore.signed, false);
    assert.ok(report.cases.coveredAfter.receipts.some((r) => r.signed && r.result === '已签收并归港'));
    assert.ok(report.cases.branches.every((b) => b.same));
    assert.ok(report.cases.fleetShared.drones.some((d) => d.received > 0));
    assert.ok(report.cases.fleetLocal.drones.every((d) => d.received === 0));
    for (const group of [report.cases.fleetLocal, report.cases.fleetShared]) {
      assert.equal(group.receipts.length, 3);
      assert.ok(group.receipts.every((r) => r.result === '已签收并归港' && r.collisions === 0));
    }
    assert.ok(report.cases.checkpoints.at(-1).receipts.some((r) => r.signed));
    const [localObservation, sharedObservation] = report.cases.teamObservation;
    assert.equal(localObservation.surveyResponses.length, 0);
    assert.ok(sharedObservation.surveyResponses.length > 0 && sharedObservation.maxNewCells > 0);
    for (const group of report.cases.teamObservation) {
      assert.deepEqual(group.notifications, group.receipts.map((r) => r.drone));
      assert.equal(group.receipts.length, 2);
      assert.ok(group.receipts.every((r) => r.result === '已签收并归港' && r.collisions === 0));
    }
  } else if (mode === 'dataset') {
    report.data = await collect(page);
    console.log(JSON.stringify(report.data));
  } else if (mode === 'native') {
    const runs = [];
    for (const fleet of [1, 3]) {
      await page.evaluate(async (fleet) => {
        const g = window.aeromind;
        g.verifiedMode = true;
        await g.pending;
        g.reset({ ...g.sim.s.config, chapter: fleet === 1 ? 2 : 5, fleet });
        g.sim.order(1);
        if (fleet > 1) {
          g.sim.order(2);
          g.sim.order(3);
        }
        g.verifiedMode = false;
      }, fleet);
      await page.waitForTimeout(2800);
      await page.evaluate(() => {
        const g = window.aeromind;
        g.metrics.intervals = [];
        g.metrics.inference = [];
        g.sim.latencies = [];
      });
      await page.waitForTimeout(24000);
      runs.push(
        await page.evaluate(() => {
          const g = window.aeromind,
            p = (a, n) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * n)] : null);
          return {
            fleet: g.sim.s.drones.length,
            frames: g.metrics.intervals.length,
            medianFps: 1000 / p(g.metrics.intervals, 0.5),
            p95FrameMs: p(g.metrics.intervals, 0.95),
            p95InferenceMs: p(g.metrics.inference, 0.95),
            p95ControlMs: p(g.sim.latencies, 0.95),
            controlSamples: g.sim.latencies.length,
            draws: g.view.renderer.info.render.calls,
            discarded: g.metrics.dropped,
          };
        })
      );
      console.log(JSON.stringify(runs.at(-1)));
    }
    report.runs = runs;
    await writeFile(out + '/native.json', JSON.stringify(report, null, 2));
    assert.ok(runs.every((r) => r.medianFps >= 30 && r.p95ControlMs <= 350 && r.controlSamples > 0));
  } else if (mode === 'lecture-live') {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const started = Date.now();
      await page.evaluate(() => {
        const g = window.aeromind;
        g.verifiedMode = false;
        g.beginLecture();
        g.metrics.intervals = [];
        g.metrics.inference = [];
      });
      await page.waitForFunction(() => window.aeromind.lectureTime < 0 || !!window.aeromind.error, null, {
        polling: 1000,
        timeout: 560000,
      });
      const row = await page.evaluate(() => {
        const g = window.aeromind,
          p = (a, n) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * n)] : null);
        return {
          ended: g.lectureTime < 0,
          queued:g.sim.s.orders.length,
          finalPhases:g.sim.s.drones.map(d=>d.phase),
          receipts: g.lectureReport,
          error: g.error,
          frames: g.serial,
          medianFps: 1000 / p(g.metrics.intervals, 0.5),
          p95InferenceMs: p(g.metrics.inference, 0.95),
          p95ControlMs: p(g.sim.latencies, 0.95),
          ages: g.sim.s.drones.map((d) => ({
            drone: d.id,
            sent: d.shared,
            received: d.received,
            expired: d.lost,
          })),
        };
      });
      row.wallSeconds = (Date.now() - started) / 1000;
      runs.push(row);
      report.runs = runs;
      console.log('wall clock lecture', i + 1, row.wallSeconds, row.receipts.length, row.error);
      await writeFile(out + '/lecture-live.json', JSON.stringify(report, null, 2));
      assert.ok(row.ended && !row.error);
    }
  } else if (mode === 'lecture') {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const r = await page.evaluate(async () => {
        const g = window.aeromind;
        g.verifiedMode = true;
        await g.pending;
        g.beginLecture();
        for (let sec = 0; sec < 420; sec += 7) await g.advance(7, 0.23);
        if (g.lectureTime >= 0) await g.advance(0.1, 0.2);
        return {
          finished: g.lectureTime < 0,
          outcomes: g.lectureReport,
          simTime: g.sim.s.time,
          frames: g.serial,
          drones: g.sim.s.drones.map((d) => ({
            sent: d.shared,
            received: d.received,
            lost: d.lost,
            poses: d.poseN,
          })),
          error: g.error,
        };
      });
      runs.push(r);
      console.log('lecture', i + 1, r.finished, r.outcomes.length, r.outcomes.filter((v) => v.signed).length);
      report.runs = runs;
      await writeFile(out + '/lecture.json', JSON.stringify(report, null, 2));
      assert.ok(r.finished && !r.error);
    }
  } else if (mode === 'interaction') {
    report.result = await classroomUI(page, out);
  } else throw Error('Unknown verification mode.');
  await writeFile(out + '/' + mode + '.json', JSON.stringify(report, null, 2));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS', mode);
} finally {
  await browser.close();
  await unlink(sessionFile).catch(() => {});
  if (server.exitCode === null && server.signalCode === null) {
    const timeout = setTimeout(() => server.kill(), 9000);
    await new Promise((resolve) => server.once('exit', resolve));
    clearTimeout(timeout);
  }
}
