import {STATIONS} from './city';
const aliases=[['物流枢纽','物流中心','南港'],['图书馆','图书'],['医院','医疗','社区收货区'],['工程站','工地','施工区'],['宿舍','宿舍柜'],['体育馆','体育场']];
export function interpret(text:string) {
  const parts=text.trim().split(/[,，。；;]/).filter(Boolean);
  const names=new Set<number>(),avoidNames=new Set<number>();
  for(const part of parts){
    const separate=part.split(/避开|绕开|禁止飞越|不要经过/);
    aliases.forEach((words,id)=>{
      if(id>0&&id<STATIONS.length&&words.some(w=>separate[0].includes(w)))names.add(id);
      if(separate.slice(1).some(s=>words.some(w=>s.includes(w))))avoidNames.add(id);
    });
  }
  const deadline=text.match(/(\d{1,3})\s*(秒|分钟)/);
  return {destinations:[...names],avoid:([...avoidNames][0]??null) as number|null,
    priority:/优先|紧急|加急|先送/.test(text)?5:2,wait:!/不等|不要等|直接返/.test(text),
    seconds:deadline?Math.min(600,Math.max(8,Number(deadline[1])*(deadline[2]==='分钟'?60:1))):115};
}
