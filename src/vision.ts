import type {Detection, Flow} from './vision-types';

export interface Region { x:number; y:number; w:number; h:number }
export function segment(rgba:Uint8Array,w:number,h:number) {
  const mask=new Uint8Array(w*h), gray=new Uint8Array(w*h);
  for(let n=0;n<mask.length;n++) {
    const r=rgba[n*4],g=rgba[n*4+1],b=rgba[n*4+2];
    gray[n]=(r*77+g*150+b*29)>>8;
    if(g>42 && b>38 && g>r*1.58 && b>r*1.48 && b/g>.73 && b/g<1.2) mask[n]=1;
  }
  const seen=new Uint8Array(mask.length), queue=new Int32Array(mask.length), regions:Region[]=[];
  for(let k=0;k<mask.length;k++) {
    if(!mask[k]||seen[k]) continue;
    let head=0,tail=1,x0=w,y0=h,x1=0,y1=0; queue[0]=k; seen[k]=1;
    while(head<tail) {
      const p=queue[head++],x=p%w,y=(p-x)/w;
      x0=Math.min(x0,x); x1=Math.max(x1,x); y0=Math.min(y0,y); y1=Math.max(y1,y);
      for(const q of [x>0?p-1:-1,x+1<w?p+1:-1,p-w,p+w]) if(q>=0&&q<mask.length&&!seen[q]&&mask[q]) {
        seen[q]=1; queue[tail++]=q;
      }
    }
    const rw=x1-x0+1,rh=y1-y0+1;
    if(rw>=7 && rh>=7 && rw/rh>.57 && rw/rh<1.7 && x0>0 && y0>0 && x1<w-1 && y1<h-1 &&
       tail>=rw*rh*.085 && tail<rw*rh*.88) regions.push({x:x0,y:y0,w:rw,h:rh});
  }
  regions.sort((a,b)=>b.w*b.h-a.w*a.h);
  return {mask,gray,regions:regions.slice(0,8)};
}
export function crop(gray:Uint8Array,width:number,regions:Region[]) {
  const result=new Float32Array(regions.length*576);
  regions.forEach((r,k)=>{
    for(let y=0;y<24;y++) for(let x=0;x<24;x++) {
      const sx=r.x+Math.min(r.w-1,Math.floor((x+.5)*r.w/24)),sy=r.y+Math.min(r.h-1,Math.floor((y+.5)*r.h/24));
      result[k*576+y*24+x]=gray[sy*width+sx]/255;
    }
  });
  return result;
}
export function classify(logits:Float32Array,regions:Region[],prior:Detection[],next:()=>number):Detection[] {
  const found:Detection[]=[], used=new Set<number>();
  regions.forEach((r,k)=>{
    const values=logits.subarray(k*6,k*6+6), top=Math.max(...values), label=values.indexOf(top);
    const score=1/Array.from(values).reduce((s,v)=>s+Math.exp(v-top),0);
    if(label===5 || score<.64) return;
    const x=r.x+r.w/2,y=r.y+r.h/2;
    const prev=prior.filter(p=>p.label===label&&!used.has(p.track))
      .sort((a,b)=>Math.hypot(x-a.x,y-a.y)-Math.hypot(x-b.x,y-b.y))[0];
    const track=prev && Math.hypot(x-prev.x,y-prev.y)<Math.max(24,r.w) ? prev.track : next();
    used.add(track); found.push({...r,x,y,label,score,track});
  });
  return found;
}
export function shrink(gray:Uint8Array,w:number,h:number) {
  const small=new Uint8Array(w*h/4);
  for(let y=0;y<h;y+=2) for(let x=0;x<w;x+=2)
    small[(y/2)*(w/2)+x/2]=(gray[y*w+x]+gray[y*w+x+1]+gray[(y+1)*w+x]+gray[(y+1)*w+x+1])/4;
  return small;
}
// Track high-contrast tabletop features in successive down-camera frames.
export function opticalFlow(previous:Uint8Array|undefined,now:Uint8Array,w:number,h:number):Flow {
  const flow:Flow={x:0,y:0,count:0,points:[]};
  if(!previous || previous.length!==now.length) return flow;
  const xs:number[]=[], ys:number[]=[];
  for(let gy=9;gy<h-12;gy+=10) for(let gx=9;gx<w-12;gx+=10) {
    let px=gx,py=gy,gradient=0;
    for(let y=gy;y<gy+4;y++) for(let x=gx;x<gx+4;x++) {
      const p=y*w+x, score=Math.min(Math.abs(previous[p-1]-previous[p+1]),Math.abs(previous[p-w]-previous[p+w]));
      if(score>gradient){gradient=score;px=x;py=y;}
    }
    if(gradient<10) continue;
    let best=Infinity,second=Infinity,bx=0,by=0;
    for(let dy=-6;dy<=6;dy++) for(let dx=-6;dx<=6;dx++) {
      let err=0;
      for(let j=-2;j<=2;j++) for(let i=-2;i<=2;i++) err+=Math.abs(previous[(py+j)*w+px+i]-now[(py+j+dy)*w+px+i+dx]);
      if(err<best){second=best;best=err;bx=dx;by=dy;} else second=Math.min(second,err);
    }
    if(best<420 && second>best*1.13+6) {xs.push(bx*2);ys.push(by*2);flow.points.push((px+bx)*2,(py+by)*2);}
  }
  const median=(v:number[])=>v.sort((a,b)=>a-b)[Math.floor(v.length/2)]||0;
  flow.count=xs.length;flow.x=median(xs);flow.y=median(ys);return flow;
}
