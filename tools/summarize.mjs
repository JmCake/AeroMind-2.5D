import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.argv[2] || 'artifacts/windows/AeroMind.exe';
const suiteNames = ['smoke', 'standard', 'perception', 'scenarios', 'interaction', 'native', 'lecture', 'lecture-live', 'launcher'];
const binary = await readFile(executable);
const sha256 = createHash('sha256').update(binary).digest('hex');
const raw = {};
for (const suite of suiteNames) {
  const report = JSON.parse(await readFile('output/playwright/' + suite + '.json', 'utf8'));
  assert.equal(report.mode, suite);
  assert.equal(report.testedApplicationSha256, sha256, 'Executable mismatch in ' + suite);
  if (suite !== 'launcher') {
    assert.equal(report.packaged, true);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.external, []);
  }
  raw[suite] = report;
}
const finished = (r) => r?.signed && r.result === '已签收并归港';
const round = (n) => n == null ? null : Number(n.toFixed(4));
const compact = (v) => JSON.parse(JSON.stringify(v, (_, n) => typeof n === 'number' ? round(n) : n));
const sum = (values) => values.reduce((a, b) => a + b, 0);
function trips(rows) {
  const receipts = rows.filter(Boolean);
  const outcomes = {};
  for (const r of receipts) outcomes[r.result] = (outcomes[r.result] || 0) + 1;
  const minDistances = receipts.map((r) => r.closest).filter(Number.isFinite);
  const errors = receipts.filter((r) => r.signed && Number.isFinite(r.error)).map((r) => r.error);
  return {
    receipts: receipts.length, returnedSigned: receipts.filter(finished).length,
    outcomes, collisionEventsOnReceipts: sum(receipts.map((r) => r.collisions)),
    minRecordedInterDroneMetres: minDistances.length ? Math.min(...minDistances) : null,
    maxSignedDropErrorMetres: errors.length ? Math.max(...errors) : null,
    totalPathMetres: sum(receipts.map((r) => r.path)),
    totalEnergyPercentagePoints: sum(receipts.map((r) => r.energy)),
  };
}
function experiment(group) {
  return {
    summary: trips(group.receipts),
    orders: group.receipts,
    drones: group.drones.map(({phase, views, viewGain, accepted, sent, received, dropped, mapCells, points}) =>
      ({phase, views, viewGain, accepted, sent, received, dropped, mapCells, points})),
  };
}
function lectures(suite, realtime) {
  assert.equal(suite.runs.length, 10, 'Ten complete lecture runs are required.');
  const runs = suite.runs.map((r, i) => {
    assert.ok((realtime ? r.ended : r.finished) && !r.error);
    if (realtime) assert.ok(r.wallSeconds >= 419 && r.wallSeconds < 560);
    const row = { round: i + 1, ...trips(realtime ? r.receipts : r.outcomes) };
    if (realtime) Object.assign(row, {
      wallSeconds: r.wallSeconds, queuedAtCutoff: r.queued, phasesAtCutoff: r.finalPhases,
      cameraFrameSerial: r.frames, medianFpsEndWindow: r.medianFps,
      p95InferenceMsEndWindow: r.p95InferenceMs, p95ControlMsEndWindow: r.p95ControlMs,
    });
    return row;
  });
  return {
    continuousRuns: runs.length, simulationSecondsPerRun: 420,
    wallSeconds: realtime ? sum(runs.map((r) => r.wallSeconds)) : null,
    ...trips(suite.runs.flatMap((r) => realtime ? r.receipts : r.outcomes)), runs,
  };
}

const standard = raw.standard.results;
assert.equal(standard.length, 10);
const orders = standard.map((r) => r.receipt);
assert.ok(orders.filter(finished).length >= 9);
assert.ok(standard.every((r) => r.accepted > 0 && r.receipt?.collisions === 0 && r.receipt.error <= 1.5));
assert.ok(raw.native.runs.every((r) => r.controlSamples > 0 && r.medianFps >= 30 && r.p95ControlMs <= 350));
const cases = raw.scenarios.cases;
const machine = os.cpus();
const sourceRevision = execFileSync('git', ['log', '-1', '--format=%H', '--', 'src', 'public',
  'tools/build.mjs', 'tools/launch.py', 'tools/package.ps1', 'package-lock.json'], { encoding: 'utf8' }).trim();
const { hardware } = raw.native;
const evidence = compact({
  application: { name: path.basename(executable), bytes: binary.byteLength, sha256, sourceRevision },
  completedAt: (await stat('output/playwright/lecture-live.json')).mtime.toISOString(),
  host: { cpu: machine[0].model, logicalProcessors: machine.length, osVisibleRamBytes: os.totalmem(),
    system: os.type() + ' ' + os.release(), ...hardware },
  scope: {
    runtime: 'One local Windows executable, system Edge and WebGL 2. The model uses one CPU/WASM thread.',
    network: 'All browser suites intercepted and blocked non-loopback HTTP requests. No external request or uncaught page error was observed.',
    classroom: 'Ten lecture-live runs used one Edge page at 1× normal playback. Native frame times were measured separately in a visible window.',
    geometry: 'Distances are metres in the game. Energy is percentage points. A solo trip has no inter-drone distance.',
    metrics: 'Lecture collision, path, error and energy totals cover receipts available at the seven-minute boundary. Unfinished work is recorded separately for real-time rounds.',
    humanTest: 'Classroom controls were tested through pointer and keyboard interaction. Student comprehension requires a classroom trial.',
  },
  suites: suiteNames,
  launcher: raw.launcher,
  headedNative: raw.native.runs.map(({ draws, ...r }) => ({ ...r, lastRenderPassDrawCalls: draws })),
  standard: { ...trips(orders), orders: standard.map((r) => ({seed: r.seed, acceptedDetections: r.accepted, ...r.receipt})) },
  perception: { ...raw.perception.metrics, cpuNetwork: raw.perception.network },
  scenarios: {
    covered: { at22Seconds: cases.coveredBefore, after: experiment(cases.coveredAfter) },
    sameStart: cases.branches.map((b) => ({
      adaptive: b.adaptive, sameExternalStart: b.same, traceSamples: b.trace,
      millimetreTraceHash: b.millimetreTraceHash, ...experiment(b),
    })),
    fleetLocal: experiment(cases.fleetLocal), fleetShared: experiment(cases.fleetShared),
    teamObservation: cases.teamObservation.map((b) => ({
      share: b.share, maxNewConfirmedCells: b.maxNewCells, surveyResponses: b.surveyResponses,
      receiptNotifications: b.notifications, ...experiment(b),
    })),
    checkpoints: cases.checkpoints.map((b) => ({ model: b.model, ...experiment(b) })),
    learned: experiment(cases.learned),
  },
  classroomControls: raw.interaction.result,
  acceleratedLecture: lectures(raw.lecture, false),
  realtimeLecture: lectures(raw['lecture-live'], true),
});
await mkdir('verification', { recursive: true });
await writeFile('verification/results.json', JSON.stringify(evidence, null, 2) + '\n');
console.log('Recorded all', suiteNames.length, 'release checks for', sha256);
