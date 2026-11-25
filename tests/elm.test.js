import test from "node:test";
import assert from "node:assert/strict";
import { Elm } from "../js/elm.js";
import { DemoTransport } from "../js/transport.js";
import { readModule, readDids, sweep, compareSweeps } from "../js/diag.js";
import { buildReport } from "../js/report.js";
import { moduleByName } from "../js/data.js";

class Recorder { constructor(){ this.sent=[]; this.active=0; this.maxActive=0; this.isDemo=true; this.connected=true; }
  async send(cmd){ this.active++; this.maxActive=Math.max(this.maxActive,this.active); this.sent.push(cmd); await new Promise(r=>setTimeout(r,Math.random()*5)); this.active--;
    if (cmd.startsWith("AT")) return "OK\r\r"; return "62 "+cmd.slice(2,4)+" "+cmd.slice(4,6)+" 01\r\r"; } }

test("queue never runs two adapter exchanges at once", async()=>{
  const t=new Recorder(), elm=new Elm(t);
  await Promise.all([elm.uds(0x7E4,"224910"), elm.uds(0x7E5,"224810"), elm.uds(0x7E4,"22490F"), elm.uds(0x726,"22DD09")]);
  assert.equal(t.maxActive,1);
  // header switches happen right before their own request
  const i=t.sent.indexOf("224810"); assert.ok(t.sent.slice(0,i).includes("ATSH7E5"));
});
test("blocked requests never reach the adapter", async()=>{
  const t=new Recorder(), elm=new Elm(t);
  assert.throws(()=>elm.uds(0x7E4,"14FFFFFF"));
  assert.throws(()=>elm.uds(0x7E4,"2E491000"));
  await elm.uds(0x7E4,"224910");
  assert.ok(!t.sent.some(c=>c.startsWith("14")||c.startsWith("2E")));
});
test("reads the simulated car end to end", async()=>{
  const elm=new Elm(new DemoTransport({latency:0}));
  await elm.init();
  const becm=await readModule(elm, moduleByName("BECM"));
  assert.deepEqual(becm.dtcs.map(d=>d.full),["P0AA6-00","U3001-00"]);
  assert.equal(becm.dtcs[0].snapshot.records[0].items[0].value,62113);
  const v=await readDids(elm);
  assert.equal(v["State of charge"].v,70);
  assert.equal(v["Pack voltage"].v,361.4);
  const rep=buildReport({version:"test",vin:"DEMO",scanResults:{BECM:becm},lastLive:v,clearEvents:[],logLines:[]});
  assert.match(rep,/SUMMARY FOR THE GARAGE/);
  assert.match(rep,/P0AA6-00\s+High-voltage isolation fault/);
  assert.match(rep,/Read-only session/);
  assert.match(rep,/38,595 mi/);
});
test("sweep finds answering values and restores the timeout", async()=>{
  const t=new DemoTransport({latency:0}), elm=new Elm(t);
  await elm.init();
  const r=await sweep(elm,0x7E5,[[0x4800,0x4820]]);
  assert.deepEqual(Object.keys(r.found).sort(),["4810","4811","4812"]);
  assert.equal(elm.fast,false);
  assert.deepEqual(compareSweeps({"4810":"00 00","4812":"01"},{"4810":"00 F0","4812":"01"}),["4810"]);
});
test("sweep can be stopped", async()=>{
  const elm=new Elm(new DemoTransport({latency:0})); await elm.init();
  const ctrl=new AbortController(); let n=0;
  const r=await sweep(elm,0x7E5,[[0x4000,0x4FFF]],{signal:ctrl.signal,onProgress:()=>{ if(++n===2) ctrl.abort(); }});
  assert.equal(r.stopped,true); assert.ok(r.done<4096);
});
