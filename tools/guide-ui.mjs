import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// Run the three lessons through the public controls, with the real-time classroom clock.
export async function guideUI(page, directory, recordExample) {
  const action = page.locator('#action'), results = [];
  const button = (name) => page.getByRole('button', { name, exact: true });
  async function waitForButton(name) {
    try { await button(name).waitFor({ timeout: 135000 }); }
    catch (error) {
      const state = await page.evaluate(() => {
        const s = window.aeromind.sim.s;
        return { time: s.time, drones: s.drones.map((d) => [d.phase, d.reason, d.signed]), receipts: s.completed, log: s.log.slice(-5) };
      });
      throw Error(String(error) + JSON.stringify(state));
    }
  }
  async function evidence(requireCover) {
    const handle = await page.waitForFunction((cover) => {
      const g = window.aeromind, frame = g.frames.get(g.selected), pair = document.querySelector('#image-pair');
      if (!frame || Number(pair.dataset.frame) !== frame.input.frame || pair.dataset.source !== 'live') return false;
      const found = frame.result.detections.find((d) => d.label === 1);
      if (cover ? (found || !g.paused || g.sim.s.drones[0].phase !== 'search') : !found) return false;
      const read = (id) => document.querySelector(id).getContext('2d').getImageData(0, 0, 192, 144).data;
      const raw = read('#raw'), marked = read('#detected');
      return { frame: frame.input.frame, sample: frame.input.sample, model: frame.result.model,
        rawMatchesCamera: raw.every((v, i) => v === frame.input.pixels[i]),
        differentChannels: marked.reduce((n, v, i) => n + (v !== raw[i]), 0),
        libraryScore: found?.score ?? null, activeCover: g.sim.s.events.some((e) =>
          e.kind === 'occupied' && e.at <= g.sim.s.time && g.sim.s.time < e.at + e.duration),
        source: pair.dataset.source };
    }, requireCover, { polling: 60, timeout: 85000 });
    const data = await handle.jsonValue();
    assert.ok(data.rawMatchesCamera);
    if (requireCover) { assert.equal(data.libraryScore, null); assert.ok(data.activeCover); }
    else { assert.ok(data.libraryScore > .74); assert.ok(data.differentChannels > 0); assert.equal(data.activeCover, false); }
    return data;
  }
  const initial = await page.evaluate(() => ({
    title: document.querySelector('h1').textContent,
    buttons: [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length).map((b) => b.id),
    selectors: document.querySelectorAll('select').length,
    orders: window.aeromind.sim.s.orders.length, paused: window.aeromind.paused,
  }));
  assert.deepEqual(initial, { title: '把包裹送到图书馆', buttons: ['action'], selectors: 0, orders: 0, paused: true });
  await waitForButton('开始配送');
  if (!recordExample) {
    await page.waitForFunction(() => document.querySelector('#image-pair').dataset.source === 'example');
    await page.screenshot({ path: directory + '/guide-start.png' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => {
    const g = window.aeromind, pin = document.querySelector('.pin.destination'), city = document.querySelector('#city');
    const p = g.view.project(g.sim.city.fixtures[1]), box = pin.getBoundingClientRect(), area = city.getBoundingClientRect();
    return Math.abs(parseFloat(pin.style.left) - p.x) < 1 && box.left >= area.left && box.right <= area.right;
  });
  const mobile = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
    actionBottom: document.querySelector('#action').getBoundingClientRect().bottom,
    visionWidth: document.querySelector('#detected').getBoundingClientRect().width }));
  assert.ok(mobile.content <= mobile.width);
  assert.ok(mobile.actionBottom <= 320 && mobile.visionWidth >= 140);
  if (!recordExample) await page.screenshot({ path: directory + '/guide-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  let coveredFrame, revealedFrame;
  for (let i = 0; i < 3; i++) {
    if (i) await button('下一课').click();
    const startButton = ['开始配送', '遮住柜标并起飞', '派出三架无人机'][i];
    await waitForButton(startButton);
    await page.evaluate(() => { window.aeromind.metrics.intervals = []; });
    if (i === 0) { await action.focus(); await page.keyboard.press('Enter'); }
    else await button(startButton).click();
    const assigned = await page.evaluate(() => window.aeromind.sim.s.drones.map((d) => d.order?.station).sort());
    assert.deepEqual(assigned, i === 2 ? [1, 2, 3] : [1]);
    if (i === 0) {
      await button('暂停配送').click();
      const pauseTime = await page.evaluate(() => window.aeromind.sim.s.time);
      await page.waitForTimeout(450);
      assert.equal(await page.evaluate(() => window.aeromind.sim.s.time), pauseTime);
      await button('继续配送').click();
      results.push({ assigned, detected: await evidence(false) });
    } else if (i === 1) {
      await waitForButton('移开遮挡');
      coveredFrame = await evidence(true);
      const waitingTime = await page.evaluate(() => window.aeromind.sim.s.time);
      await page.waitForTimeout(550);
      assert.equal(await page.evaluate(() => window.aeromind.sim.s.time), waitingTime);
      await page.screenshot({ path: directory + '/guide-cover.png' });
      await button('移开遮挡').click();
      revealedFrame = await evidence(false);
      assert.ok(revealedFrame.frame > coveredFrame.frame);
      results.push({ assigned, coveredFrame, revealedFrame });
    } else results.push({ assigned });
    await waitForButton(i === 2 ? '再上一次课' : '下一课');
    const outcome = await page.evaluate(() => {
      const g = window.aeromind, ordered = [...g.metrics.intervals].sort((a, b) => a - b);
      return { receipts: g.sim.s.completed, review: document.querySelector('#image-pair').dataset.source,
        reviewFrame: Number(document.querySelector('#image-pair').dataset.frame),
        medianFps: Math.round(10000 / ordered[Math.floor(ordered.length / 2)]) / 10,
        intervalSamples: ordered.length, p95FrameMs: Number(ordered[Math.floor(ordered.length * .95)].toFixed(1)),
        sharedMessages: g.sim.s.drones.reduce((sum, d) => sum + d.received, 0) };
    });
    Object.assign(results[i], outcome);
    assert.equal(outcome.receipts.length, assigned.length);
    assert.ok(outcome.receipts.every((r) => r.signed && r.result === '已签收并归港'));
    assert.equal(outcome.review, 'review');
    if (i === 2) assert.ok(outcome.sharedMessages > 0);
    if (!i) {
      await page.screenshot({ path: directory + '/guide-result.png' });
      if (recordExample) {
        const base64 = await page.evaluate(() => {
          const c = document.createElement('canvas');
          c.width = 384; c.height = 144;
          const ctx = c.getContext('2d');
          ctx.drawImage(document.querySelector('#raw'), 0, 0);
          ctx.drawImage(document.querySelector('#detected'), 192, 0);
          return c.toDataURL('image/png').split(',')[1];
        });
        await writeFile(directory + '/guide-example.png', Buffer.from(base64, 'base64'));
      }
    }
    console.log('入门课', i + 1, outcome.receipts.map((r) => r.result).join('、'), outcome.medianFps, 'FPS');
  }
  await button('再上一次课').click();
  await waitForButton('开始配送');
  await page.goto(new URL('#cover', page.url()).href);
  await waitForButton('遮住柜标并起飞');
  await page.getByRole('link', { name: '自由实验' }).click();
  await page.locator('#dispatch').waitFor();
  assert.ok(new URL(page.url()).pathname.endsWith('/lab.html'));
  await page.getByRole('link', { name: '返回入门课' }).click();
  await waitForButton('遮住柜标并起飞');
  await button('← 上一课').click();
  await waitForButton('开始配送');
  return { initial, mobile, lessons: results, labRoundTrip: true };
}
