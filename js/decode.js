/* Pure decoding helpers (no DOM, no Bluetooth) so they can be unit tested. */
import { SNAPSHOT_DIDS } from "./data.js";

export const hex2 = n => n.toString(16).toUpperCase().padStart(2,"0");
export const hex3 = n => n.toString(16).toUpperCase().padStart(3,"0");
export const hex4 = n => n.toString(16).toUpperCase().padStart(4,"0");
export const toHex = b => Array.from(b).map(hex2).join(" ");

export const STATUS_BITS = ["failing now","failed this drive cycle","pending","confirmed","not tested since cleared","failed since cleared","not tested this cycle","warning light requested"];
export const statusWords = s => STATUS_BITS.filter((_,i)=>s&(1<<i));

export function dtcName(b0,b1,b2){
  const L="PCBU"[b0>>6], d=(b0>>4)&3, rest=((b0&0xF).toString(16)+hex2(b1)).toUpperCase();
  return {code:L+d+rest, full:L+d+rest+"-"+hex2(b2), hex:hex2(b0)+hex2(b1)+hex2(b2)};
}

/* Parse ELM327 output (CAF1, headers off, spaces on or off) into bytes, or {error} */
const ERRS=["NO DATA","CAN ERROR","BUS INIT","UNABLE TO CONNECT","STOPPED","?","BUFFER FULL","ERROR","BUS BUSY","FB ERROR","DATA ERROR"];
export function parseElm(text){
  const lines=String(text).replace(/>/g,"").split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
  let msgs=[], cur=null;
  for (let ln of lines){
    if (ln.startsWith("SEARCHING")) continue;
    if (ERRS.some(e=>ln.startsWith(e))) return {error:ln};
    ln=ln.replace(/\s+/g,"");
    if (/^[0-9A-F]{3}$/.test(ln)){ cur=[]; msgs.push({b:cur,len:parseInt(ln,16)}); continue; }
    const m=ln.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m && cur){ cur.push(...m[2].match(/../g).map(x=>parseInt(x,16))); continue; }
    if (/^[0-9A-F]+$/.test(ln) && ln.length%2===0){ cur=null; msgs.push({b:ln.match(/../g).map(x=>parseInt(x,16)),len:null}); continue; }
  }
  msgs = msgs.map(m=> m.len!=null ? m.b.slice(0,m.len) : m.b).filter(b=>!(b[0]===0x7F && b[2]===0x78));
  if (!msgs.length) return {error:"empty reply"};
  return {bytes:msgs[msgs.length-1]};
}

export const NRC={0x10:"general reject",0x11:"service not supported",0x12:"sub-function not supported",0x13:"bad length",0x14:"response too long",0x22:"conditions not correct",0x31:"not available",0x33:"security access denied",0x7E:"not supported in this session",0x7F:"not supported in this session"};

/* Turn raw ELM text for a request into {bytes} or {error, nrc} */
export function interpret(raw, reqHex){
  const p=parseElm(raw);
  if (p.error) return p;
  const b=p.bytes;
  if (b[0]===0x7F) return {error:"refused: "+(NRC[b[2]]||("code "+hex2(b[2]))), nrc:b[2]};
  if (b[0]!==parseInt(reqHex.slice(0,2),16)+0x40) return {error:"unexpected reply "+b.map(hex2).join("")};
  return {bytes:b};
}

/* 59 02 mask [dtc(3) status]... */
export function parseDtcList(b){
  const out=[];
  for (let i=3;i+3<b.length;i+=4){
    const n=dtcName(b[i],b[i+1],b[i+2]);
    out.push({...n, status:b[i+3], words:statusWords(b[i+3])});
  }
  return out;
}

/* Structured snapshot decoding (ISO 14229 ReportDTCSnapshotRecordByDTCNumber):
   59 04 DTC(3) status, then per record: recordNumber, count, [DID(2) data]...
   Data lengths are only known for DIDs in SNAPSHOT_DIDS; at the first unknown DID we stop and keep the rest raw. */
export function decodeSnapshot(b){
  const res={records:[], undecoded:null, complete:true};
  if (!b || b.length<6 || b[0]!==0x59 || b[1]!==0x04) { res.complete=false; return res; }
  let i=6;
  while (i<b.length){
    if (i+1>=b.length){ res.undecoded=toHex(b.slice(i)); res.complete=false; break; }
    const rec={record:b[i], count:b[i+1], items:[]}; i+=2;
    res.records.push(rec);
    for (let k=0;k<rec.count;k++){
      if (i+2>b.length){ res.complete=false; break; }
      const did=(b[i]<<8)|b[i+1], def=SNAPSHOT_DIDS[did];
      if (!def || i+2+def.len>b.length){ res.undecoded=toHex(b.slice(i)); res.complete=false; return res; }
      const data=b.slice(i+2,i+2+def.len);
      rec.items.push({did, name:def.name, unit:def.unit, value:def.f(data)});
      i+=2+def.len;
    }
  }
  return res;
}
export function fmt(v){ return Number.isInteger(v)? String(v) : v.toFixed(2); }
export const kmToMi = km => Math.round(km*0.621371);
export function snapshotText(s){
  const parts=[];
  for (const r of s.records) for (const it of r.items){
    if (it.did===0xDD01) parts.push("Odometer "+kmToMi(it.value).toLocaleString("en-GB")+" mi");
    else parts.push(it.name+" "+fmt(it.value)+" "+it.unit);
  }
  return parts;
}
