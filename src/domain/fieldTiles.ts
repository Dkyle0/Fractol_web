export interface FieldTile {x:number;y:number;width:number;height:number}
/** Stable center-out order, including rectangular edge tiles exactly once. */
export function fieldTiles(width:number,height:number,side=128):FieldTile[] {
 const tiles:FieldTile[]=[];
 for(let y=0;y<height;y+=side)for(let x=0;x<width;x+=side)tiles.push({x,y,width:Math.min(side,width-x),height:Math.min(side,height-y)});
 const distance=(t:FieldTile)=>((t.x+t.width/2-width/2)/width)**2+((t.y+t.height/2-height/2)/height)**2;
 return tiles.sort((a,b)=>distance(a)-distance(b)||a.y-b.y||a.x-b.x);
}
