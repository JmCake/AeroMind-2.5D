export interface Detection { label:number; score:number; x:number; y:number; w:number; h:number; track:number }
export interface Flow { x:number; y:number; count:number; points:number[] }
export type Checkpoint = 'early'|'middle'|'mature';
export interface Observation {
  frame:number; drone:number; epoch:number; sample:number; wall:number; model:Checkpoint;
  detections:Detection[]; flow:Flow; ms:number; candidates:number; mask:Uint8Array;
}
export interface Capture {
  type:'frame'; frame:number; drone:number; epoch:number; sample:number; wall:number;
  model:Checkpoint; pixels:Uint8Array; width:number; height:number;
}
