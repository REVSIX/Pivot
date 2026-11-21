declare module 'gifenc' {
 type Pixels=Uint8Array|Uint8ClampedArray
 type Palette=number[][]
 export function quantize(pixels:Pixels,colors:number,options:{format:'rgb444'}):Palette
 export function applyPalette(pixels:Pixels,palette:Palette,format:'rgb444'):Uint8Array
 export function GIFEncoder():{
  writeFrame(indices:Uint8Array,width:number,height:number,options:{palette:Palette;delay:number;repeat:number}):void
  finish():void
  bytes():Uint8Array
 }
}
