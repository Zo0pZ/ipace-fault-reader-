/* Diagnostic routines built on the Elm queue. No DOM. */
import { BECM_DIDS, WATCH_DIDS } from "./data.js";
import { parseDtcList, decodeSnapshot, toHex, hex4 } from "./decode.js";

export async function readModule(elm, mod){
  const [tx,short,long]=mod;
  const out={module:short, desc:long, addr:tx, dtcs:[], error:null};
  const r = await elm.uds(tx,"1902FF");
  if (r.error){ out.error=r.error; return out; }
  out.dtcs = parseDtcList(r.bytes);
  for (const d of out.dtcs){
    const s=await elm.uds(tx,"1904"+d.hex+"FF");
    d.snapshotRaw = s.error ? "("+s.error+")" : toHex(s.bytes);
    d.snapshot = s.error ? null : decodeSnapshot(s.bytes);
    const e=await elm.uds(tx,"1906"+d.hex+"FF");
    d.extendedRaw = e.error ? "("+e.error+")" : toHex(e.bytes);
  }
  return out;
}

export async function readDids(elm, dids=BECM_DIDS.map(d=>d[0])){
  const vals={};
  for (const did of dids){
    const def=BECM_DIDS.find(d=>d[0]===did);
    const r=await elm.uds(0x7E4,"22"+hex4(did));
    vals[def[1]] = r.error ? null : {v:def[4](r.bytes.slice(3)), unit:def[2]};
  }
  return vals;
}
export const readWatchValues = elm => readDids(elm, WATCH_DIDS);

/* Read-only sweep: ReadDataByIdentifier over DID ranges. Returns {did: hex}. */
export async function sweep(elm, tx, ranges, {onProgress=()=>{}, signal}={}){
  const found={}; let total=0, done=0;
  for (const [a,b] of ranges) total+=b-a+1;
  await elm.setFast(true);
  try{
    for (const [a,b] of ranges){
      for (let did=a; did<=b; did++){
        if (signal && signal.aborted) return {found, done, total, stopped:true};
        const r=await elm.uds(tx,"22"+hex4(did),{timeout:3000,quiet:true});
        if (!r.error) found[hex4(did)] = toHex(r.bytes.slice(3));
        done++; if (done%16===0 || done===total) onProgress(done,total,Object.keys(found).length);
      }
    }
  } finally { await elm.setFast(false); }
  return {found, done, total, stopped:false};
}
export function compareSweeps(prev, cur){
  const changed=[];
  for (const k of Object.keys(cur)) if (prev && prev[k]!==undefined && prev[k]!==cur[k]) changed.push(k);
  return changed;
}
