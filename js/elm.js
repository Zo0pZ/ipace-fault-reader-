/* ELM327 + UDS layer with a strict one-at-a-time command queue. */
import { assertAdapterCommand, checkRequest } from "./safety.js";
import { interpret, hex3 } from "./decode.js";

const sleep = ms => new Promise(r=>setTimeout(r,ms));

export class Elm {
  constructor(transport, log=()=>{}){ this.t=transport; this.log=log; this.q=Promise.resolve(); this.hdr=null; this.fast=false; }
  /* Every adapter exchange runs through here, so two requests can never overlap. */
  run(fn){ const p=this.q.then(fn); this.q=p.catch(()=>{}); return p; }
  async _at(cmd){
    assertAdapterCommand(cmd);
    const r=await this.t.send(cmd, cmd==="ATZ"?8000:4000);
    this.log("> "+cmd+"  < "+String(r).replace(/\s+/g," ").trim());
    return r;
  }
  init(){
    return this.run(async()=>{
      this.hdr=null; this.fast=false;
      await this._at("ATZ"); await sleep(this.t.isDemo?0:800);
      for (const c of ["ATE0","ATL0","ATS0","ATH0","ATSP6","ATAT1","ATSTFF"]) await this._at(c);
      return String(await this._at("ATI")).trim();
    });
  }
  async _select(tx){
    if (this.hdr===tx) return;
    const h=hex3(tx), r=hex3(tx+8);
    await this._at("ATSH"+h); await this._at("ATCRA"+r);
    try { await this._at("ATFCSH"+h); await this._at("ATFCSD300000"); await this._at("ATFCSM1"); }
    catch(e){ this.log("flow-control setup not supported: "+e.message); }
    this.hdr=tx;
  }
  /* Shorter reply timeout for sweeps (ATST32 ≈ 200 ms), normal otherwise */
  setFast(on){ return this.run(async()=>{ if (this.fast===on) return; await this._at(on?"ATST32":"ATSTFF"); this.fast=on; }); }
  uds(tx, hex, {allowClear=false, timeout=8000, quiet=false}={}){
    hex = checkRequest(hex, allowClear);     // throws before anything is queued
    return this.run(async()=>{
      await this._select(tx);
      const raw=await this.t.send(hex, timeout);
      if (!quiet) this.log(hex3(tx)+" > "+hex+"  < "+String(raw).replace(/\s+/g," ").trim());
      return interpret(raw, hex);
    });
  }
}
