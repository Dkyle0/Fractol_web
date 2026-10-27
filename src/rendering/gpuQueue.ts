export { submitFence, settleFence, type GpuFence } from './gpuFence';
/** Delayed polls in independent tasks avoid nested-timer clamping. No spin. */
export function gpuTaskYield() {
 const channel=new MessageChannel(),pending=new Map<number,()=>void>();let id=0;
 channel.port1.onmessage=event=>{const resolve=pending.get(event.data);pending.delete(event.data);if(resolve)setTimeout(resolve,1);};
 return {wait:()=>new Promise<void>(resolve=>{pending.set(++id,resolve);channel.port2.postMessage(id);}),dispose(){channel.port1.close();channel.port2.close();for(const resolve of pending.values())resolve();pending.clear();}};
}
