interface PreviewIR {instructions:number[][];resumePc:number;stateFields:number[]}
interface Block {start:number;end:number;op:number;last:number[]}
/** Lower the trusted single-orbit CFG into forward structured branches and one
 * dynamic orbit loop. No formula arithmetic is invented or reassociated here.
 * Unsupported back edges/oversized output deliberately retain the old shader.
 */
export function structuredPreviewLoop(p:PreviewIR,operation:(v:number[],i:number)=>string):string|null {
  if(p.resumePc<=0||p.resumePc>=p.instructions.length)return null;
  const sink=-1,leaders=new Set([0,p.resumePc]);
  for(let i=0;i<p.instructions.length;i++){
    const [op,dst,a]=p.instructions[i]!;
    if(op!>=7){leaders.add(i+1);if([7,8,9,10,12,16].includes(op!))leaders.add(dst!);if(op===11||op===15){if(a!==p.resumePc)return null;leaders.add(dst!);}}
    if(op!>16||op===17)return null;
    if([7,8,9,10,12,16].includes(op!)&&dst!<=i)return null;
  }
  const starts=[...leaders].filter(i=>i<p.instructions.length).sort((a,b)=>a-b),blocks=new Map<number,Block>();
  starts.forEach((start,i)=>{const end=starts[i+1]??p.instructions.length,last=p.instructions[end-1]!;blocks.set(start,{start,end,op:last[0]!,last});});
  const guard='if(ds_invalid){code=254;halted=true;break;}';
  let emitted=0;
  const region=(root:number,initial:boolean)=>{
    const normalize=(target:number)=>target===p.resumePc||target>=p.instructions.length?sink:target;
    const edges=(block:Block):number[]=>{
      const [op,d]=block.last;
      if(op===13)return [sink];
      if(op===11||op===15)return [normalize(d!),sink];
      if(op===12)return [normalize(d!)];
      if([7,8,9,10,16].includes(op!))return [normalize(d!),normalize(block.end)];
      return [normalize(block.end)];
    };
    const post=new Map<number,Set<number>>([[sink,new Set([sink])]]),visiting=new Set<number>();
    const postdom=(pc:number):Set<number>=>{
      if(post.has(pc))return post.get(pc)!;
      if(visiting.has(pc))throw Error('Unsupported preview back edge');visiting.add(pc);
      const block=blocks.get(pc);if(!block)throw Error('Missing preview block');
      const successors=edges(block);for(const next of successors)if(next!==sink&&next<=pc)throw Error('Unsupported preview back edge');
      const sets=successors.map(postdom),common=new Set([...sets[0]!].filter(value=>sets.every(set=>set.has(value))));common.add(pc);
      post.set(pc,common);visiting.delete(pc);return common;
    };
    // The loop header is allowed as this region's root only.
    postdom(root);
    const emit=(start:number,stop:number):string=>{
      let pc=start,text='';
      while(pc!==sink&&pc!==stop){
        if(++emitted>4096)throw Error('Preview structure exceeds compilation budget');
        const block=blocks.get(pc)!,[op,d,a,b]=block.last;
        for(let i=block.start;i<block.end;i++){
          const instruction=p.instructions[i]!;
          if(instruction[0]!<=6||instruction[0]===14)text+=operation(instruction,i)+'\n';
        }
        if(op===13){text+=`code=${a};halted=true;if(ds_invalid)code=254;break;\n`;return text;}
        if(op===11)text+='n++;\n';
        text+=guard+'\n';
        const successors=edges(block);
        if(successors.length===1){pc=successors[0]!;continue;}
        const common=[...postdom(successors[0]!)].filter(next=>postdom(successors[1]!).has(next)&&next!==sink);
        const join=common.length?Math.min(...common):sink;
        let condition:string;
        if(op===11||op===15)condition='n>=u_iterations';
        else if(op===7)condition=`ds_lt(r${b},r${a})`;
        else if(op===8)condition=`ds_le(r${a},r${b})`;
        else if(op===9)condition=`ds_zero(r${a})`;
        else if(op===10)condition=`ds_bad(r${a})`;
        else if(op===16)condition=`any(isnan(r${a}))`;
        else throw Error('Unsupported structured preview branch');
        text+=`if(${condition}){\n${emit(successors[0]!,join)}}else{\n${emit(successors[1]!,join)}}\n`;pc=join;
      }
      return text;
    };
    // Initial setup never traverses the orbit header; orbit lowering starts there.
    return emit(root,initial?p.resumePc:sink);
  };
  try{
    const initial=region(0,true),orbit=region(p.resumePc,false);
    const restore=p.stateFields.map((r,i)=>`r${r}=uintBitsToFloat(${i<2?'saved0':'saved1'}.${i%2===0?'xy':'zw'});`).join('');
    const result=`bool initialized=false;
for(int orbitStep=0;orbitStep<u_iterations+2;orbitStep++){
 if(!initialized){${initial}initialized=true;if(resuming){${restore}n=int(meta.x);resuming=false;}}
 ${orbit}
 if(n>=int(meta.x)+u_sliceIterations)break;
}`;
    return result.length<=200_000?result:null;
  }catch{return null;}
}
