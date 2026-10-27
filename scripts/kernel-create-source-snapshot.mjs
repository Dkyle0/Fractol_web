import { createArtifactRoot } from './lib/runArtifacts.mjs';
const artifactsRoot = await createArtifactRoot('kernel-create-source-snapshot');
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const output=process.env.KERNEL_SNAPSHOT_NAME;
if(!output||!/^[a-z0-9._-]+$/i.test(output))throw Error('Set a unique KERNEL_SNAPSHOT_NAME');
const destination=path.resolve(artifactsRoot,output),files={};
await mkdir(destination,{recursive:false});
async function copyTree(from,to,relative=''){
 await mkdir(to,{recursive:true});
 for(const entry of await readdir(from,{withFileTypes:true})){
  const rel=relative?`${relative}/${entry.name}`:entry.name,src=path.join(from,entry.name),dst=path.join(to,entry.name);
  if(entry.isDirectory())await copyTree(src,dst,rel);
  else if(entry.isFile()){
   await copyFile(src,dst);files[rel]=createHash('sha256').update(await readFile(dst)).digest('hex');
  }else throw Error(`Unsupported source entry: ${rel}`);
 }
}
try{
 await copyTree(path.resolve('src'),destination);
 const manifest={method:'sha256-source-snapshot-v1',createdAt:new Date().toISOString(),files};
 await writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});
 const raw=await readFile(path.join(destination,'manifest.json'));
 console.log(JSON.stringify({snapshot:destination,files:Object.keys(files).length,manifestHash:createHash('sha256').update(raw).digest('hex')},null,2));
}catch(error){console.error(error);process.exitCode=1;}
