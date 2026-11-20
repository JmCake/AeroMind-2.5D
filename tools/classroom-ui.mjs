import assert from 'node:assert/strict';

export async function classroomUI(page, directory) {
  await page.locator('[data-chapter="4"]').click();
  await page.locator('#command').click();
  await page.locator('#language').fill('先把包裹送到图书馆或医院，避开体育馆上空，限时120秒，占用时等一会儿');
  await page.locator('#parse').click();
  const parsed = await page.locator('#parsed').innerText();
  assert.match(parsed, /有多个目的地/);
  assert.match(parsed, /避开体育馆/);
  assert.match(parsed, /120 秒/);
  await page.locator('#resolved').selectOption('2');
  await page.locator('#submit-command').click();
  const station = await page.evaluate(() => {
    const state = window.aeromind.sim.s;
    return (state.orders[0] ?? state.drones[0].order)?.station;
  });
  assert.equal(station, 2);

  await page.locator('#events').click();
  await page.locator('#event-position').selectOption('1');
  await page.locator('#place-event').click();
  await page.locator('#events').click();
  await page.locator('#event-kind').selectOption('closed');
  await page.locator('#event-position').selectOption('map');
  await page.locator('#event-layer').selectOption('1');
  await page.locator('#place-event').click();
  await page.locator('#viewport canvas').filter({ visible: true }).first().click({ position: { x: 445, y: 250 } });
  const placed = await page.evaluate(() => structuredClone(window.aeromind.sim.s.events));
  assert.equal(placed.length, 2);
  assert.equal(placed[1].kind, 'closed');
  await page.locator('#events').click();
  await page.locator('#undo-event').click();
  await page.locator('#close').click();
  assert.equal(await page.evaluate(() => window.aeromind.sim.s.events.length), 1);

  await page.locator('#map').click();
  await page.locator('#knowledge').click({ position: { x: 445, y: 250 } });
  assert.match(await page.locator('#panel-title').innerText(), /地图格/);
  await page.locator('#mask').click();
  await page.locator('#cloud').click();
  assert.equal(await page.locator('#cloud-view').isVisible(), true);
  await page.locator('#next-layer').click();
  assert.equal(await page.locator('#panel').isVisible(), false);
  await page.locator('#map').click();
  await page.locator('#laboratory').click();
  await page.locator('#save-snap').click();
  await page.waitForFunction(() => !!window.aeromind.snapshot);
  await page.locator('#adaptive').click();
  await page.waitForFunction(() => !document.querySelector('#panel').open);

  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => window.aeromind.sim.s.drones[0].manual), true);
  await page.keyboard.down('d');
  assert.equal(await page.evaluate(() => window.aeromind.sim.manualInput.x), 1);
  await page.keyboard.up('d');
  await page.keyboard.press('m');
  assert.equal(await page.evaluate(() => window.aeromind.sim.s.drones[0].manual), false);
  await page.locator('#settings').click();
  await page.locator('#sharing').selectOption('no');
  await page.locator('#apply').click();
  await page.locator('#settings').click();
  await page.locator('#store').click();
  await page.reload();
  await page.waitForFunction(() => window.aeromind?.ready);
  await page.locator('#settings').click();
  await page.locator('#load').click();
  const restored = await page.evaluate(() => {
    const s = window.aeromind.sim.s;
    return { shared: s.config.share, chapter: s.config.chapter, events: s.events.length };
  });
  assert.deepEqual(restored, { shared: false, chapter: 4, events: 1 });

  await page.locator('[data-chapter="2"]').click();
  await page.locator('#reset').click();
  await page.waitForFunction(() => {
    const g = window.aeromind;
    return g.sim.s.events.length === 0 && g.sim.extra.length === 0 && g.view.moving.children.length === 0;
  }, null, { timeout: 3000 });
  await page.locator('#station').selectOption('1');
  await page.locator('#dispatch').click();
  const evidence = await page.waitForFunction(() => {
    const g = window.aeromind;
    const frame = g.frames.get(0);
    const hit = frame?.result.detections.find((v) => v.label === 1);
    const d = g.sim.s.drones[0];
    if (!hit || !['out', 'search', 'dock'].includes(d.phase)) return false;
    g.paused = true;
    g.onUpdate();
    return { frame: frame.result.frame, time: g.sim.s.time, model: frame.result.model, score: hit.score, phase: d.phase };
  }, null, { timeout: 80000 }).catch(async (error) => {
    const snapshot = await page.evaluate(() => {
      const g = window.aeromind;
      return { ready: g.ready, error: g.error, paused: g.paused, cfg: g.sim.s.config,
        time: g.sim.s.time, log: g.sim.s.log.slice(-12), order: g.sim.s.drones[0].order,
        camera: g.frames.get(0)?.result.detections, phase: g.sim.s.drones[0].phase, reason: g.sim.s.drones[0].reason };
    });
    throw Error(error.message + '\n' + JSON.stringify(snapshot));
  });
  const observation = await evidence.jsonValue();
  await page.screenshot({ path: directory + '/classroom.png' });
  return { parsed, selectedStation: station, mapEvent: placed[1], restored, observation };
}
