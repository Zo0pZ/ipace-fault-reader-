/* Builds the plain-text report. Pure function of the app state, so it can be tested. */
import { noteParts, DTC_NOTES } from "./data.js";
import { hex2, hex3, fmt, kmToMi, snapshotText } from "./decode.js";

export function buildReport(st){
  const L=[], when=d=>new Date(d).toLocaleString("en-GB");
  const live=st.lastLive||{}, g=k=>live[k]?live[k].v:null;
  const mods=Object.values(st.scanResults||{});
  const faults=mods.flatMap(r=>r.dtcs.map(d=>({...d,module:r.module})));
  L.push("I-PACE FAULT READER: SUMMARY FOR THE GARAGE");
  L.push("=".repeat(44));
  L.push("Created:   "+when(st.now||Date.now())+"   (app version "+st.version+")");
  L.push("VIN:       "+(st.vin||"not read"));
  if (g("Odometer")!=null) L.push("Odometer:  "+kmToMi(g("Odometer")).toLocaleString("en-GB")+" mi (from battery module)");
  if (g("State of charge")!=null) L.push("Battery:   "+fmt(g("State of charge"))+"% charge"+(g("Health (capacity)")!=null?", "+fmt(g("Health (capacity)"))+"% health":"")+(g("Pack voltage")!=null?", "+fmt(g("Pack voltage"))+" V":""));
  L.push(st.clearEvents && st.clearEvents.length ? "NOTE: codes WERE cleared during this session (see below)." : "Read-only session: nothing was cleared or written to the car.");
  L.push("");
  L.push("Fault codes found ("+faults.length+"):");
  if (!mods.length) L.push("  (no scan run)");
  for (const f of faults){
    const [ttl]=noteParts(f.code);
    L.push("  "+f.module.padEnd(6)+" "+f.full.padEnd(9)+" "+ttl+"  ["+(f.words.join(", ")||"stored")+"]");
  }
  const w=st.watch;
  if (w && w.events && w.events.length){
    L.push("");
    L.push("Charge attempt:");
    if (w.plugTime) L.push("  Plugged in at "+new Date(w.plugTime).toLocaleTimeString("en-GB"));
    const firstFault=w.events.find(e=>e.kind==="fault" && (!w.plugTime || e.t>=w.plugTime));
    if (firstFault) L.push("  First fault change: "+new Date(firstFault.t).toLocaleTimeString("en-GB")+"  "+firstFault.text+(w.plugTime?"  ("+Math.round((firstFault.t-w.plugTime)/1000)+" s after plugging in)":""));
    else L.push("  No fault status changed during the watch.");
    if (w.maxCurrent!=null) L.push("  Highest charging current seen: "+fmt(w.maxCurrent)+" A");
  }
  if (st.sweeps && Object.keys(st.sweeps).length){
    L.push("");
    L.push("Values that changed between sweeps (possible charger/isolation readings):");
    let any=false;
    for (const [mod,s] of Object.entries(st.sweeps)) if (s.changed && s.changed.length){ any=true; for (const k of s.changed) L.push("  "+mod+" DID "+k+": "+s.prev[k]+"  ->  "+s.cur[k]); }
    if (!any) L.push("  (none yet: run a sweep unplugged, then again plugged in)");
  }
  L.push("");
  L.push("=".repeat(44));
  L.push("DETAILS");
  L.push("");
  L.push("== FAULT CODES BY MODULE ==");
  for (const r of mods){
    const a=hex3(r.addr);
    if (r.error){ L.push(r.module+" ["+a+"]: "+r.error); continue; }
    if (!r.dtcs.length){ L.push(r.module+" ["+a+"]: no codes"); continue; }
    L.push(r.module+" ["+a+"] "+r.desc+":");
    for (const d of r.dtcs){
      L.push("  "+d.full+"  status 0x"+hex2(d.status)+" ("+(d.words.join(", ")||"stored")+")");
      if (DTC_NOTES[d.code]) L.push("    "+DTC_NOTES[d.code]);
      if (d.snapshot){
        const parts=snapshotText(d.snapshot);
        if (parts.length) L.push("    Logged at: "+parts.join(", "));
        if (!d.snapshot.complete) L.push("    (part of the snapshot uses data this app can't decode; raw data below)");
      }
      L.push("    snapshot raw: "+d.snapshotRaw);
      L.push("    extended raw: "+d.extendedRaw);
    }
  }
  L.push("");
  L.push("== BATTERY VALUES (latest) ==");
  if (st.lastLive) for (const [k,x] of Object.entries(st.lastLive)) L.push("  "+k+": "+(x?fmt(x.v)+" "+x.unit:"no reply"));
  else L.push("  (not read)");
  L.push("");
  L.push("== CHARGE WATCH EVENTS ==");
  if (w && w.events.length) for (const e of w.events) L.push("  "+new Date(e.t).toLocaleTimeString("en-GB")+"  "+e.text); else L.push("  (watch not run)");
  if (w && w.rows && w.rows.length){
    L.push(""); L.push("== CHARGE WATCH LOG (CSV) ==");
    const keys=Object.keys(w.rows[0]); L.push(keys.join(","));
    for (const r of w.rows) L.push(keys.map(k=>r[k]??"").join(","));
  }
  if (st.sweeps && Object.keys(st.sweeps).length){
    L.push(""); L.push("== DID SWEEPS (read-only) ==");
    for (const [mod,s] of Object.entries(st.sweeps)){
      L.push(mod+": "+Object.keys(s.cur).length+" values answered"+(s.stopped?" (stopped early)":""));
      for (const [k,v] of Object.entries(s.cur)) L.push("  "+k+" = "+v+(s.changed&&s.changed.includes(k)?"   <- changed (was "+s.prev[k]+")":""));
    }
  }
  L.push(""); L.push("== CODES CLEARED IN THIS SESSION ==");
  L.push(...((st.clearEvents&&st.clearEvents.length)?st.clearEvents.map(e=>"  "+e):["  (none)"]));
  L.push(""); L.push("== ADAPTER LOG ==");
  L.push(...(st.logLines||[]));
  return L.join("\n");
}
