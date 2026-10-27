import { getFractal } from '../domain/catalog';
import type { SceneState } from '../domain/types';
import { doubleWords } from './binary64';
import { unitRoots64 } from '../domain/roots';
import {kernelFeatures,type KernelVariant} from './kernel';

// Integer GPU ALU bytecode. One copy of each binary64 primitive in the shader
// avoids exponential inlining/optimization in ANGLE and the native driver.
type Complex = [number,number];
type Instruction = [number,number,number,number];
export const ALU = { add:0,sub:1,mul:2,div:3,abs:4,neg:5,mov:6,gt:7,le:8,zero:9,bad:10,next:11,jump:12,end:13,count:14,limit:15,nan:16,pairImag:18,square:19,norm:20,inverseGuard:22,inverseFallback:23,scaleNormal:24 } as const;
class ProgramBuilder {
  constructor(private features=kernelFeatures('reference')){}
  values: number[]=[];
  persistent=new Set<number>();
  code: Instruction[]=[];
  labels=new Map<number,number>();
  fixups: { at:number; component:1|2; label:number }[]=[];
  private constants=new Map<string,number>();
  private nextLabel=0;
  reg(value=0) { const r=this.values.length;this.values.push(value);this.persistent.add(r);return r; }
  constant(value:number) { const key=Object.is(value,-0)?'-0':String(value);if(!this.constants.has(key))this.constants.set(key,this.reg(value));return this.constants.get(key)!; }
  temp() { const r=this.values.length;this.values.push(0);return r; }
  emit(op:number,dst:number,a=0,b=0) { this.code.push([op,dst,a,b]); }
  op(op:number,a:number,b=0) { const r=this.temp();this.emit(op,r,a,b);return r; }
  add(a:number,b:number) { return this.op(ALU.add,a,b); }
  sub(a:number,b:number) { return this.op(ALU.sub,a,b); }
  mul(a:number,b:number) { return this.op(ALU.mul,a,b); }
  div(a:number,b:number) { return this.op(ALU.div,a,b); }
  abs(a:number) { return this.op(ALU.abs,a); }
  neg(a:number) { return this.op(ALU.neg,a); }
  move(dst:number,a:number) { this.emit(ALU.mov,dst,a); }
  complex(x=0,y=0):Complex { return [this.reg(x),this.reg(y)]; }
  copy(dst:Complex,a:Complex) { this.move(dst[0],a[0]);this.move(dst[1],a[1]); }
  ca(a:Complex,b:Complex):Complex { return [this.add(a[0],b[0]),this.add(a[1],b[1])]; }
  cs(a:Complex,b:Complex):Complex { return [this.sub(a[0],b[0]),this.sub(a[1],b[1])]; }
  scale(a:Complex,s:number):Complex { return [this.mul(a[0],s),this.mul(a[1],s)]; }
  cm(a:Complex,b:Complex):Complex { return [this.sub(this.mul(a[0],b[0]),this.mul(a[1],b[1])),this.add(this.mul(a[0],b[1]),this.mul(a[1],b[0]))]; }
  square(a:Complex):Complex {
    if(this.features.blocks){const real=this.temp(),imag=this.temp();this.emit(ALU.square,real,...a);this.emit(ALU.pairImag,imag);return [real,imag];}
    return [this.sub(this.mul(a[0],a[0]),this.mul(a[1],a[1])),this.mul(this.mul(this.constant(2),a[0]),a[1])];
  }
  norm2(a:Complex) { return this.features.blocks?this.op(ALU.norm,...a):this.add(this.mul(a[0],a[0]),this.mul(a[1],a[1])); }
  power(a:Complex,n:number):Complex { let v:Complex=[this.constant(1),this.constant(0)];for(let j=0;j<n;j++)v=this.cm(v,a);return v; }
  cd(a:Complex,b:Complex):Complex {
    const x=this.abs(b[0]),y=this.abs(b[1]),s=this.reg(),larger=this.label(),done=this.label();
    this.branch(ALU.gt,x,y,larger);this.move(s,y);this.jump(done);this.mark(larger);this.move(s,x);this.mark(done);
    const d:Complex=[this.div(b[0],s),this.div(b[1],s)],v:Complex=[this.div(a[0],s),this.div(a[1],s)],den=this.norm2(d);
    return [this.div(this.add(this.mul(v[0],d[0]),this.mul(v[1],d[1])),den),this.div(this.sub(this.mul(v[1],d[0]),this.mul(v[0],d[1])),den)];
  }
  inverse(a:Complex):Complex {
    if(!this.features.reciprocal)return this.cd([this.constant(1),this.constant(0)],a);
    const output=this.complex(),exponent=this.reg(),fallback=this.label(),done=this.label();
    this.emit(ALU.inverseGuard,exponent,...a);this.branch(ALU.inverseFallback,exponent,0,fallback);
    const x=this.op(ALU.scaleNormal,a[0],exponent),y=this.op(ALU.scaleNormal,a[1],exponent);
    const inverse=this.div(this.constant(1),this.norm2([x,y]));
    this.move(output[0],this.op(ALU.scaleNormal,this.mul(x,inverse),exponent));
    this.move(output[1],this.op(ALU.scaleNormal,this.neg(this.mul(y,inverse)),exponent));this.jump(done);
    this.mark(fallback);this.copy(output,this.cd([this.constant(1),this.constant(0)],a));this.mark(done);
    return output;
  }
  label() { return this.nextLabel++; }
  mark(label:number) { this.labels.set(label,this.code.length); }
  branch(op:number,a:number,b:number,label:number) { this.fixups.push({at:this.code.length,component:1,label});this.emit(op,0,a,b); }
  jump(label:number) { this.branch(ALU.jump,0,0,label); }
  complexZero(a:Complex,label:number) {
    const check=this.label(),done=this.label();this.branch(ALU.zero,a[0],0,check);this.jump(done);this.mark(check);this.branch(ALU.zero,a[1],0,label);this.mark(done);
  }
  finish() {
    for(const f of this.fixups){const target=this.labels.get(f.label);if(target==null)throw new Error('Undefined precision label');this.code[f.at]![f.component]=target;}
    // Linear liveness applies to expression temporaries only. All loop-carried
    // values and branch outputs are persistent registers, never recycled.
    const last=new Map<number,number>();
    const sourceFields=(op:number): (2|3)[] => {
      if(op<=ALU.div || op===ALU.gt || op===ALU.le || op===ALU.inverseGuard || op===ALU.scaleNormal || op===ALU.square || op===ALU.norm)return [2,3];
      if(op===ALU.abs || op===ALU.neg || op===ALU.mov || op===ALU.zero || op===ALU.bad || op===ALU.nan || op===ALU.inverseFallback)return [2];
      return [];
    };
    this.code.forEach((instruction,i) => { for(const k of sourceFields(instruction[0]))last.set(instruction[k]!,i); });
    const mapping=new Map<number,number>();let count=0;const free:number[]=[];
    for(const r of this.persistent)mapping.set(r,count++);
    const packed:Instruction[]=[],initial:number[][]=[];
    const writes=(op:number)=>op<=ALU.mov||op===ALU.inverseGuard||op===ALU.scaleNormal||op===ALU.pairImag||op===ALU.square||op===ALU.norm;
    for(const r of this.persistent)initial[mapping.get(r)!]=[...doubleWords(this.values[r]!),0,0];
    this.code.forEach((instruction,i) => {
      const output=[...instruction] as Instruction,op=instruction[0];
      if(writes(op) && !mapping.has(instruction[1]))mapping.set(instruction[1],free.pop()??count++);
      if(writes(op))output[1]=mapping.get(instruction[1])!;
      for(const k of sourceFields(op))output[k]=mapping.get(instruction[k]!)!;
      packed.push(output);
      for(const k of sourceFields(op)){const r=instruction[k]!;if(!this.persistent.has(r)&&last.get(r)===i){free.push(mapping.get(r)!);last.delete(r);}}
    });
    if(count>128)throw new Error(`Too many precision registers: ${count}`);
    const width=Math.max(count,packed.length),data=new Uint32Array(width*8);
    packed.forEach((instruction,i)=>data.set(instruction,i*4));initial.forEach((value,i)=>data.set(value,width*4+i*4));
    return { data,width,length:packed.length,registers:count,index:(r:number)=>mapping.get(r)! };
  }
}

export function preciseProgram(scene:SceneState,width:number,height:number,stableInputs=false,kernel:KernelVariant='reference') {
  const p=new ProgramBuilder(kernelFeatures(kernel)),id=scene.fractalId,parameters=scene.parameters,definition=getFractal(id);
  // Preview shaders specialize control flow, never camera/parameter values.
  // Inputs must not alias mathematical literals when their current value matches.
  const input=(value:number)=>stableInputs?p.reg(value):p.constant(value);
  const zero=p.constant(0),one=p.constant(1),two=p.constant(2),four=p.constant(4),eps=p.constant(1e-5*1e-5);
  const offset=p.complex(),z=p.complex(),c=p.complex(),previous=p.complex(),old=p.complex();
  const error=p.reg(Infinity),before=p.reg(Infinity),root=p.reg();
  const threshold=input(scene.camera.height),resolution=input(height);
  const point:Complex=[p.add(input(scene.camera.x),p.div(p.mul(offset[0],threshold),resolution)),p.add(input(scene.camera.y),p.div(p.mul(offset[1],threshold),resolution))];
  p.copy(c,point);
  if(['julia','legacy-ship','legacy-something','newton','phoenix'].includes(id))p.copy(z,point);
  if(id==='julia')p.copy(c,[input(parameters.juliaRe),input(parameters.juliaIm)]);
  if(id==='phoenix')p.copy(c,[input(parameters.phoenixRe??.56667),input(parameters.phoenixIm??0)]);
  if(id==='nova')p.copy(z,[one,zero]);
  let limit=four;
  if(id==='julia'){
    limit=p.reg(4);const sum=p.add(p.norm2(c),two),done=p.label();p.branch(ALU.le,sum,four,done);p.move(limit,sum);p.mark(done);
  }else if(id==='legacy-something')limit=p.constant(16);
  const singular=p.label(),bad=p.label(),escaped=p.label(),converged=p.label(),unresolved=p.label(),loop=p.label();
  const residual=() => {
    const large=p.label(),done=p.label();p.branch(ALU.gt,p.norm2(z),four,large);
    p.move(error,p.norm2(p.cs(p.power(z,parameters.power),[one,zero])));p.jump(done);
    p.mark(large);p.move(error,p.constant(1e40));p.mark(done);
  };
  if(id==='newton'){residual();p.branch(ALU.le,error,eps,converged);}
  if(id==='magnet-1')p.move(error,one);
  p.mark(loop);
  if(definition.shaderKind<10)p.branch(id==='legacy-ship'?ALU.le:ALU.gt,id==='legacy-ship'?limit:p.norm2(z),id==='legacy-ship'?p.norm2(z):limit,escaped);
  p.copy(old,z);p.move(before,error);
  const square=id==='newton'||id==='nova'?z:p.square(z);
  switch(id){
    case 'burning-ship':p.copy(z,p.ca([square[0],p.abs(square[1])],c));break;
    case 'tricorn':p.copy(z,p.ca([square[0],p.neg(square[1])],c));break;
    case 'multibrot':p.copy(z,p.ca(p.power(z,parameters.power),c));break;
    case 'celtic':p.copy(z,p.ca([p.abs(square[0]),square[1]],c));break;
    case 'buffalo':p.copy(z,p.ca([p.abs(square[0]),p.abs(square[1])],c));break;
    case 'perpendicular':p.copy(z,p.ca([square[0],p.neg(p.mul(p.mul(two,p.abs(z[0])),z[1]))],c));break;
    case 'legacy-ship':p.copy(z,[p.abs(p.add(square[0],c[0])),p.add(p.abs(square[1]),c[1])]);break;
    case 'legacy-something':p.move(z[0],p.add(square[0],c[0]));p.move(z[1],p.add(p.mul(p.mul(two,z[0]),old[1]),c[1]));p.copy(c,p.ca(p.scale(c,p.constant(.5)),z));break;
    case 'newton':case 'nova':{
      p.complexZero(z,singular);const inverse=p.inverse(z);
      if(id==='newton'){
        const fraction=p.constant(1/parameters.power);
        p.copy(z,p.ca(p.scale(z,p.sub(one,fraction)),p.scale(p.power(inverse,parameters.power-1),fraction)));residual();
      }else{
        const a=input((parameters.novaRelaxation??1)/3);
        p.copy(z,p.ca(p.ca(p.scale(z,p.sub(one,a)),p.scale(p.cm(inverse,inverse),a)),c));p.move(error,p.norm2(p.cs(z,old)));
      }break;
    }
    case 'phoenix':p.copy(z,p.ca(p.ca(square,c),p.scale(previous,input(parameters.phoenixMemory??-.5))));p.copy(previous,old);break;
    case 'magnet-1':{
      const den=p.cs(p.ca(p.scale(z,two),c),[two,zero]);p.complexZero(den,singular);
      const quotient=p.cd(p.cs(p.ca(square,c),[one,zero]),den);p.copy(z,p.cm(quotient,quotient));p.move(error,p.norm2(p.cs(z,[one,zero])));break;
    }
    default:p.copy(z,p.ca(square,c));
  }
  if(definition.shaderKind<10){p.fixups.push({at:p.code.length,component:1,label:unresolved},{at:p.code.length,component:2,label:loop});p.emit(ALU.next,0);}
  else{
    p.emit(ALU.count,0);p.branch(ALU.bad,z[0],0,bad);p.branch(ALU.bad,z[1],0,bad);p.branch(ALU.nan,error,0,bad);
    if(id!=='phoenix')p.branch(ALU.le,error,eps,converged);
    if(id==='phoenix'||id==='magnet-1')p.branch(ALU.gt,p.norm2(z),p.constant(id==='phoenix'?256:10000),escaped);
    p.fixups.push({at:p.code.length,component:1,label:unresolved},{at:p.code.length,component:2,label:loop});p.emit(ALU.limit,0);
  }
  p.mark(unresolved);p.emit(ALU.end,0,0);
  p.mark(singular);p.emit(ALU.end,0,1);
  p.mark(bad);p.emit(ALU.end,0,2);
  p.mark(escaped);p.emit(ALU.end,0,definition.shaderKind<10?255:4);
  p.mark(converged);
  if(id==='newton'){
    const best=p.reg(Infinity);
    const roots=unitRoots64(parameters.power);
    for(let j=0;j<parameters.power;j++){
      const distance=p.norm2(p.cs(z,[p.constant(roots[j*2]!),p.constant(roots[j*2+1]!)]));
      const skip=p.label();p.branch(ALU.le,best,distance,skip);p.move(best,distance);p.move(root,p.constant(j));p.mark(skip);
    }
  }
  p.emit(ALU.end,0,3);
  const result=p.finish();
  const state = id==='legacy-something'?c:id==='phoenix'?previous:[error,error];
  return { ...result,resumePc:p.labels.get(loop)!,stateFields:[...z,...state].map(result.index),offset:offset.map(result.index),output:[...z,before,error].map(result.index),root:result.index(root),kind:definition.shaderKind,legacy:definition.resultKind==='legacy-escape',widthPixels:width };
}
