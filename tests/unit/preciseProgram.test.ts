import { describe,expect,it } from 'vitest';
import { preciseProgram } from '../../src/rendering/preciseProgram';
import { createScene,fractals } from '../../src/domain/catalog';
import { evaluatePoint } from '../../src/domain/reference';
import type { SceneState } from '../../src/domain/types';

/** Compiler control-flow/register-allocation check, independent of GPU ALU tests. */
function execute(scene:SceneState) {
  const p=preciseProgram(scene,1,1),r:number[]=[],bits=new DataView(p.data.buffer);
  for(let j=0;j<p.registers;j++)r[j]=bits.getFloat64(p.width*16+j*16,true);
  r[p.offset[0]!]=0;r[p.offset[1]!]=0;
  let pc=0,n=0,code=-1;
  for(let step=0;step<p.length*(scene.iterations+2)+32;step++){
    const [op,dst,a,b]=p.data.subarray(pc*4,pc*4+4) as unknown as [number,number,number,number];
    const x=r[a]!,y=r[b]!;
    switch(op){
      case 0:r[dst]=x+y;break;case 1:r[dst]=x-y;break;case 2:r[dst]=x*y;break;case 3:r[dst]=x/y;break;
      case 4:r[dst]=Math.abs(x);break;case 5:r[dst]=-x;break;case 6:r[dst]=x;break;
      case 7:if(x>y){pc=dst;continue;}break;case 8:if(x<=y){pc=dst;continue;}break;
      case 9:if(x===0){pc=dst;continue;}break;case 10:if(!Number.isFinite(x)){pc=dst;continue;}break;
      case 11:n++;pc=n>=scene.iterations?dst:a;continue;case 12:pc=dst;continue;
      case 13:code=a;break;case 14:n++;break;case 15:pc=n>=scene.iterations?dst:a;continue;
      case 16:if(Number.isNaN(x)){pc=dst;continue;}break;
      default:throw new Error(`Bad opcode ${op}`);
    }
    if(code>=0)break;pc++;
  }
  return {status:({0:'unresolved',1:'singular',2:'numerical-error',3:'converged',4:'escaped',255:'escaped'} as Record<number,string>)[code],root:scene.fractalId==='newton'&&code===3?r[p.root]:null,n,registers:p.registers,length:p.length};
}
describe('precise formula bytecode compiler', () => {
  for(const f of fractals)it(`preserves outcomes and control flow for ${f.id}`,() => {
    for(const [x,y] of [[0,0],[1,0],[2,0],[3,3],[.6,.4],[-.4,.7]]){
      const scene=createScene(f.id);scene.iterations=128;scene.camera={x,y,height:1};
      const gpu=execute(scene),cpu=evaluatePoint(f.id,x!,y!,128,scene.parameters);
      expect(gpu.status,`${f.id} (${x},${y})`).toBe(cpu.status);expect(gpu.root).toBe(cpu.root);
      expect(gpu.registers).toBeLessThanOrEqual(128);expect(gpu.length).toBeLessThan(2048);
    }
  });
  it('compiles all Newton degrees and classifies their known roots', () => {
    for(let power=3;power<=8;power++)for(let root=0;root<power;root++){
      const scene=createScene('newton');scene.parameters.power=power;scene.camera={x:Math.cos(2*Math.PI*root/power),y:Math.sin(2*Math.PI*root/power),height:1};
      expect(execute(scene)).toMatchObject({status:'converged',root,n:0});
    }
  });
});
