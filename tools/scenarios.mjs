export async function scenarios(page) {
  return page.evaluate(async () => {
    const g = window.aeromind;
    g.verifiedMode = true;
    await g.pending;
    const base = {
      ...g.sim.s.config,
      mode: '课程',
      chapter: 4,
      seed: 811,
      fleet: 1,
      share: true,
      link: '正常',
      policy: 'classic',
      model: 'mature',
      adaptive: true,
    };
    const until = async (limit, count = 1) => {
      for (let n = 0; n < limit && !(g.sim.s.completed.length >= count); n += 4) await g.advance(4, 0.2);
    };
    const details = () => ({
      receipts: structuredClone(g.sim.s.completed),
      drones: g.sim.s.drones.map((d) => ({
        phase: d.phase,
        reason: d.reason,
        signed: d.signed,
        views: d.views,
        accepted: d.accepted,
        viewGain: d.viewGain,
        sent: d.shared,
        received: d.received,
        dropped: d.lost,
        mapCells: Object.keys(d.map).length,
        points: d.cloud.length,
        p: d.p,
        pose: d.pose,
        destination: d.destination,
        closest: d.closest,
        collisions: d.collisions,
      })),
      log: g.sim.s.log.slice(-9),
    });
    const result = {};
    g.reset(base);
    g.sim.place('occupied', 7, 1, 0, 28);
    g.sim.order(1);
    await g.advance(22, 0.2);
    result.coveredBefore = {
      signed: g.sim.s.drones[0].signed,
      views: g.sim.s.drones[0].views,
      seen: g.sim.s.drones[0].evidence?.detections,
    };
    await until(125);
    result.coveredAfter = details();
    g.reset(base);
    g.sim.order(2);
    await g.advance(5, 0.2);
    const next = g.sim.s.drones[0].route[2] ?? g.sim.s.drones[0].route[0];
    if (!next) throw Error('No planned corridor in fork fixture.');
    g.sim.place('closed', next.i, next.j, 0.2, 18);
    await g.save();
    const start = {
      time: g.snapshot.state.time,
      external: g.snapshot.state.externalRng,
      events: JSON.stringify(g.snapshot.state.events),
    };
    const branches = [];
    for (const adaptive of [false, true, true]) {
      await g.branch(adaptive);
      const s = g.sim.s;
      const same =
        s.time === start.time &&
        s.externalRng === start.external &&
        JSON.stringify(s.events) === start.events;
      await until(135);
      const path=g.sim.s.drones[0].trace;
      let fingerprint=2166136261;
      for(const p of path)for(const axis of ['x','y','z'])fingerprint=Math.imul(fingerprint^Math.round(p[axis]*1000),16777619)>>>0;
      branches.push({ adaptive, same, trace: path.length, millimetreTraceHash:fingerprint.toString(16), ...details() });
    }
    result.branches = branches;
    for (const share of [false, true]) {
      g.reset({ ...base, chapter: 5, fleet: 3, share });
      g.sim.order(1);
      g.sim.order(2);
      g.sim.order(3);
      await g.advance(7, 0.16);
      g.sim.s.config.link = '断开';
      await g.advance(5, 0.16);
      const disconnected = g.sim.s.drones.map((d) => d.reason);
      g.sim.s.config.link = '延迟';
      await g.advance(7, 0.16);
      g.sim.s.config.link = '正常';
      await until(140, 3);
      result[share ? 'fleetShared' : 'fleetLocal'] = { disconnected, ...details() };
    }
    result.checkpoints = [];
    for (const model of ['early', 'middle', 'mature']) {
      g.reset({ ...base, chapter: 2, seed: 907, model });
      g.sim.order(4, { deadline: 45 });
      await until(91);
      result.checkpoints.push({ model, ...details() });
    }
    g.reset({ ...base, policy: 'learned' });
    g.sim.place('occupied', 7, 1, 0, 27);
    g.sim.order(1);
    await until(138);
    result.learned = details();
    return result;
  });
}
