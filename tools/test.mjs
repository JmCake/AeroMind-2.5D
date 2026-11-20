import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {chromium} from 'playwright-core';
const args=process.argv.slice(2),mode=args[0]||'smoke',out='output/playwright';
await mkdir(out,{recursive:true});
const binary=process.env.AEROMIND_BROWSER||[
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/chromium','/usr/bin/google-chrome'].find(existsSync);
if(!binary)throw Error('A local Edge/Chrome executable is required; set AEROMIND_BROWSER.');
const server=spawn(process.env.AEROMIND_PYTHON||'python',['-u','tools/launch.py','--port','0','--no-browser'],{windowsHide:true});
server.stderr.on('data',b=>process.stderr.write(b));
const url=await new Promise((resolve,reject)=>{server.stdout.once('data',b=>resolve(String(b).trim()));server.once('error',reject);server.once('exit',n=>reject(Error('Host exit '+n)));});
const browser=await chromium.launch({executablePath:binary,headless:!args.includes('--headed'),
  args:['--no-first-run','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
try{
  const context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1});
  const errors=[],external=[],page=await context.newPage();
  await context.route('**/*',r=>{const u=new URL(r.request().url());
    if(u.hostname!=='127.0.0.1'&&!['data:','blob:'].includes(u.protocol)){external.push(u.hostname);return r.abort();}return r.continue();});
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error',e.message);});
  page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.goto(url+'?verify=1');await page.waitForFunction(()=>window.aeromind?.ready||window.aeromind?.error,null,{timeout:55000});
  const hardware=await page.evaluate(()=>{const g=window.aeromind,gl=g.view.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');
    return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),webgl:gl.getParameter(gl.VERSION),
      viewport:[innerWidth,innerHeight],error:g.error,browser:navigator.userAgent};});
  assert.equal(hardware.error,'');console.log(JSON.stringify(hardware));
  await page.waitForFunction(()=>window.aeromind.frames.size>0,null,{timeout:20000});
  await page.screenshot({path:out+'/city.png'});
  const report={mode,hardware,external,errors};
  if(mode==='smoke'||mode==='standard'){
    const results=[];
    for(let i=0;i<(mode==='smoke'?1:10);i++){
      const result=await page.evaluate(async seed=>{
        const g=window.aeromind;g.verifiedMode=true;await g.pending;
        g.reset({...g.sim.s.config,chapter:2,model:'mature',mode:'课程',fleet:1,seed});
        document.querySelector('#dispatch').click();
        for(let k=0;k<28 && !g.sim.s.completed.length;k++)await g.advance(5,.20);
        const d=g.sim.s.drones[0];return {seed,receipt:g.sim.s.completed[0]??null,phase:d.phase,p:d.p,
          pose:d.pose,destination:d.destination,route:d.route.slice(0,4),signed:d.signed,accepted:d.accepted,
          log:g.sim.s.log.slice(-8),vision:d.evidence,dropped:g.metrics.dropped};
      },2101+i);
      results.push(result);console.log('order',i+1,JSON.stringify(result.receipt??result));
    }
    report.results=results;await writeFile(out+'/'+mode+'.json',JSON.stringify(report,null,2));
    assert.ok(results.filter(r=>r.receipt?.signed&&r.receipt.result==='已签收并归港').length>=Math.ceil(results.length*.9));
    assert.ok(results.every(r=>r.receipt?.collisions===0&&r.receipt.error<=1.5&&r.accepted>0));
  }else if(mode==='native'){
    const runs=[];for(const fleet of [1,3]){
      await page.evaluate(async fleet=>{const g=window.aeromind;g.verifiedMode=true;await g.pending;g.reset({...g.sim.s.config,chapter:fleet===1?2:5,fleet});
        g.sim.order(1);if(fleet>1){g.sim.order(2);g.sim.order(3);}g.verifiedMode=false;},fleet);
      await page.waitForTimeout(2800);
      await page.evaluate(()=>{const g=window.aeromind;g.metrics.intervals=[];g.metrics.inference=[];g.sim.latencies=[];});
      await page.waitForTimeout(24000);
      runs.push(await page.evaluate(()=>{const g=window.aeromind,p=(a,n)=>a.length?[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)*n)]:null;
        return {fleet:g.sim.s.drones.length,frames:g.metrics.intervals.length,medianFps:1000/p(g.metrics.intervals,.5),
          p95FrameMs:p(g.metrics.intervals,.95),p95InferenceMs:p(g.metrics.inference,.95),p95ControlMs:p(g.sim.latencies,.95),
          controlSamples:g.sim.latencies.length,draws:g.view.renderer.info.render.calls,discarded:g.metrics.dropped};}));
      console.log(JSON.stringify(runs.at(-1)));
    }report.runs=runs;
  }else if(mode==='lecture'){
    const runs=[];for(let i=0;i<10;i++){
      const r=await page.evaluate(async()=>{const g=window.aeromind;g.verifiedMode=true;await g.pending;g.beginLecture();
        for(let sec=0;sec<420;sec+=7)await g.advance(7,.23);
        if(g.lectureTime>=0)await g.advance(.1,.2);
        return {finished:g.lectureTime<0,outcomes:g.lectureReport,simTime:g.sim.s.time,frames:g.serial,
          drones:g.sim.s.drones.map(d=>({sent:d.shared,received:d.received,lost:d.lost,poses:d.poseN})),error:g.error};
      });
      runs.push(r);console.log('lecture',i+1,r.finished,r.outcomes.length,r.outcomes.filter(v=>v.signed).length);
      report.runs=runs;await writeFile(out+'/lecture.json',JSON.stringify(report,null,2));assert.ok(r.finished&&!r.error);
    }
  }else if(mode==='interaction'){
    await page.getByRole('button',{name:'中文指令',exact:true}).click();await page.locator('#parse').click();
    assert.match(await page.locator('#parsed').innerText(),/体育馆/);await page.locator('#submit-command').click();
    await page.getByRole('button',{name:'布置挑战',exact:true}).click();await page.locator('#event-position').selectOption('1');
    await page.locator('#place-event').click();await page.locator('#map').click();await page.locator('#evidence').click();
    await page.locator('#mask').click();await page.locator('#next-layer').click();await page.locator('#laboratory').click();
    await page.locator('#save-snap').click();await page.waitForFunction(()=>!!window.aeromind.snapshot);
    await page.locator('#adaptive').click();await page.locator('#settings').click();await page.locator('#sharing').selectOption('no');
    await page.locator('#apply').click();await page.locator('#reset').click();
    report.result=await page.evaluate(()=>({shared:window.aeromind.sim.s.config.share,time:window.aeromind.sim.s.time}));
    assert.equal(report.result.shared,false);
  }else throw Error('Unknown verification mode.');
  await writeFile(out+'/'+mode+'.json',JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log('PASS',mode);
}finally{await browser.close();server.kill();}
