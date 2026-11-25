/* User interface. All car communication goes through Elm (queued, safety-checked). */
import { VERSION } from "./version.js";
import { CLEAR_REQUEST } from "./safety.js";
import { MODULES, moduleByName, noteParts, SWEEP_RANGES } from "./data.js";
import { fmt, kmToMi, snapshotText, dtcName } from "./decode.js";
import { Elm } from "./elm.js";
import { BleTransport, DemoTransport } from "./transport.js";
import { readModule, readDids, readWatchValues, sweep, compareSweeps } from "./diag.js";
import { buildReport } from "./report.js";

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
function el(tag, cls, text){ const e=document.createElement(tag); if(cls) e.className=cls; if(text!=null) e.textContent=text; return e; }
function svgIcon(id){ const ns="http://www.w3.org/2000/svg"; const sv=document.createElementNS(ns,"svg"); sv.setAttribute("class","i"); const u=document.createElementNS(ns,"use"); u.setAttribute("href","#"+id); sv.appendChild(u); return sv; }

/* ---------- state ---------- */
const params = new URLSearchParams(location.search);
const demo = params.has("demo");
const S = { version:VERSION, vin:"", adapterInfo:"", scanResults:{}, lastLive:null, clearEvents:[], logLines:[],
  watch:null, sweeps:{}, reportSaved:false };
let T=null, elm=null, connected=false, busyNow=false, watching=false, reconnecting=null, sweepAbort=null;

/* ---------- log / status ---------- */
function log(s){ const t=new Date().toISOString().slice(11,23); S.logLines.push(t+" "+s); if (S.logLines.length>3000) S.logLines.shift(); const e=$("log"); e.textContent=S.logLines.slice(-400).join("\n"); e.scrollTop=e.scrollHeight; }
function setStatus(text, state){ $("statusText").textContent=text; $("dot").className="dot"+(state?" "+state:""); }
function banner(text){ $("banner").textContent=text||""; $("banner").classList.toggle("show",!!text); }

/* ---------- buttons ---------- */
const NEED_CONN=["btnScanCharge","btnScanAll","btnLive","btnWatch","btnSweep"];
function sync(){
  for (const id of NEED_CONN) $(id).disabled = busyNow || !connected;
  $("btnConnect").disabled = busyNow;
  $("btnStop").disabled = !watching; $("btnPlug").disabled = !watching;
  $("btnSweepStop").disabled = !sweepAbort;
  $("qConnect").disabled=$("btnConnect").disabled; $("qScan").disabled=$("btnScanCharge").disabled; $("qBatt").disabled=$("btnLive").disabled;
  $("qWatch").disabled = !watching && $("btnWatch").disabled;
  $("qWatch").classList.toggle("live",watching); $("qConnect").classList.toggle("live",connected);
  updateClearBtn();
}
function busy(b){ busyNow=b; sync(); }

/* ---------- sheet ---------- */
function openSheet(node){ const b=$("sheetBody"); b.textContent=""; b.appendChild(node); $("sheet").classList.add("open"); $("scrim").classList.add("open"); }
function closeSheet(){ $("sheet").classList.remove("open"); $("scrim").classList.remove("open"); }
$("sheetClose").onclick=closeSheet; $("scrim").onclick=closeSheet;
function infoSheet(title, lines){ const m=el("div","mod"); m.appendChild(el("h3",null,title)); for (const t of lines) m.appendChild(el("p","sub",t)); openSheet(m); }

/* ---------- fault rendering ---------- */
function renderModule(res){
  const box=el("div","mod");
  box.appendChild(el("h3",null,res.module+" · "+res.desc));
  if (res.error){ box.appendChild(el("div","err",res.error==="NO DATA"?"No reply. The module may be asleep or not fitted.":"No result: "+res.error)); return box; }
  if (!res.dtcs.length){ box.appendChild(el("div","clean","No issues detected")); return box; }
  for (const d of res.dtcs){
    const [ttl,desc]=noteParts(d.code);
    const c=el("div","dtc"); const ic=el("div","ic"); ic.appendChild(svgIcon("i-warn")); c.appendChild(ic);
    const tx=el("div"); tx.appendChild(el("div","code",d.full)); tx.appendChild(el("div","ttl",ttl)); tx.appendChild(el("div","desc",desc));
    tx.appendChild(el("div","flags","Status: "+(d.words.join(", ")||"stored")));
    if (d.snapshot){
      const parts=snapshotText(d.snapshot);
      if (parts.length) tx.appendChild(el("div","flags","When it was logged: "+parts.join(", ")));
      if (!d.snapshot.complete) tx.appendChild(el("div","flags","Part of the snapshot uses data this app can't decode. The raw data is kept for Jaguar."));
    }
    tx.appendChild(el("div","raw","snapshot "+d.snapshotRaw)); tx.appendChild(el("div","raw","extended "+d.extendedRaw));
    c.appendChild(tx); box.appendChild(c);
  }
  return box;
}

/* ---------- health list ---------- */
const HEALTH_ICONS={BECM:"i-batt",BCCM:"i-plug",PCM:"i-chip",GWM:"i-gate",DCDC:"i-bolt","EPIC-F":"i-motor","EPIC-R":"i-motor",HVAC:"i-fan"};
const HEALTH_NAMES={BECM:"HV Battery",BCCM:"Charger & charge port",PCM:"Powertrain",GWM:"Gateway",DCDC:"DC-DC converter","EPIC-F":"Front motor inverter","EPIC-R":"Rear motor inverter",HVAC:"Climate & HV heater"};
function healthRow(short){
  let r=document.getElementById("h-"+short); if (r) return r;
  const m=moduleByName(short);
  r=el("button","hrow"); r.id="h-"+short; r.appendChild(svgIcon(HEALTH_ICONS[short]||"i-chip"));
  const t=el("span","t",HEALTH_NAMES[short]||m[2]); t.appendChild(el("small",null,short)); r.appendChild(t);
  const p=el("span","pillst"); const s=svgIcon("i-tick"); s.style.opacity=".25"; p.appendChild(s); r.appendChild(p);
  r.onclick=()=>{ const res=S.scanResults[short]; if(res) openSheet(renderModule(res)); };
  $("healthList").appendChild(r); return r;
}
function setHealth(short, state){
  const p=healthRow(short).querySelector(".pillst"); p.className="pillst "+state; p.textContent="";
  const s=svgIcon(state==="bad"?"i-warn":state==="busy"?"i-scan":"i-tick"); if(state==="none") s.style.opacity=".25"; p.appendChild(s);
}
MODULES.filter(m=>m[3]).forEach(m=>healthRow(m[1]));

/* ---------- connection, with auto-reconnect ---------- */
async function setupElm(){
  elm = new Elm(T, log);
  const ver = await elm.init();
  return ver;
}
function onDisconnect(){
  if (!connected) return;
  log("adapter disconnected");
  setStatus("Adapter disconnected","busy");
  reconnect();
}
function reconnect(){
  if (reconnecting) return reconnecting;
  reconnecting = (async()=>{
    const waits=[1000,2000,4000,8000,15000];
    for (let i=0;i<waits.length;i++){
      banner("Adapter disconnected. Reconnecting (attempt "+(i+1)+" of "+waits.length+")…");
      await sleep(waits[i]);
      try{
        await T.reconnect(); await setupElm();
        log("reconnected"); banner(""); setStatus("Reconnected","on");
        if (S.watch) addEvent("Adapter reconnected","info");
        return true;
      }catch(e){ log("reconnect failed: "+e.message); }
    }
    banner("Couldn't reconnect. Check the adapter is plugged in and the car is awake, then tap Connect.");
    connected=false; watching=false; sync(); setStatus("Disconnected","bad");
    return false;
  })().finally(()=>{ reconnecting=null; });
  return reconnecting;
}
async function ensureConnected(){ if (T && T.connected) return true; return await reconnect(); }

$("btnConnect").onclick = async ()=>{
  busy(true);
  try{
    setStatus("Connecting…","busy");
    T = demo ? new DemoTransport({dropAt: params.has("drop") ? 8 : undefined, latency: params.has("fast")?2:25}) : new BleTransport();
    T.onDisconnect = onDisconnect;
    const name = await T.open();
    const ver = await setupElm(); S.adapterInfo=name+" / "+String(ver).replace(/\s+/g," ");
    setStatus("Checking the car…","busy");
    connected=true;
    const v=await elm.uds(0x7E4,"22F190");
    if (v.error){ setStatus("Adapter connected, but the battery module didn't answer. Is the car switched on?","busy"); }
    else { S.vin=String.fromCharCode(...v.bytes.slice(3).filter(c=>c>=32&&c<127)); setStatus("Connected","on"); $("vinLine").textContent="VIN "+S.vin+(demo?" · demo":""); $("cardConnect").open=false; }
  }catch(e){
    log("connect error: "+e.message);
    if (/globally disabled|no Web Bluetooth/i.test(e.message)){
      setStatus("Bluetooth blocked in this browser","bad");
      infoSheet("Turn on Bluetooth for web pages",[
        "This browser has Bluetooth for web pages switched off. Brave, Samsung Internet, and links opened inside other apps block it.",
        "In Brave: go to brave://flags, search Web Bluetooth, set \"Web Bluetooth API\" to Enabled and tap Relaunch. Or open this page in Google Chrome.",
        "Make sure Bluetooth and Location are on, and allow \"Nearby devices\" when asked."]);
    } else setStatus(e.message,"");
  } finally { busy(false); }
};

/* ---------- scan ---------- */
async function scan(all){
  busy(true);
  const out=$("dtcOut"); out.textContent=""; S.scanResults={};
  const list = MODULES.filter(m=>all||m[3]);
  let i=0;
  try{
    for (const m of list){
      i++; setStatus("Reading "+m[1]+" ("+i+" of "+list.length+")","busy"); if (m[3]) setHealth(m[1],"busy");
      if (!await ensureConnected()) break;
      let res; try{ res=await readModule(elm,m); }catch(e){ res={module:m[1],desc:m[2],addr:m[0],dtcs:[],error:e.message}; }
      S.scanResults[m[1]]=res; out.appendChild(renderModule(res));
      if (m[3] || res.dtcs.length) setHealth(m[1], res.error? "none" : res.dtcs.length? "bad" : "ok");
    }
    const total=Object.values(S.scanResults).reduce((n,r)=>n+r.dtcs.length,0);
    setStatus(total? total+" fault code"+(total>1?"s":"")+" found" : "No faults found", total?"bad":"on");
    $("stCodes").textContent=total; $("stCodes").style.color= total? "var(--red)":"var(--green)";
    $("lastUpdated").textContent="Last updated "+new Date().toLocaleString("en-GB",{hour:"2-digit",minute:"2-digit",day:"numeric",month:"long"});
    const worst=Object.values(S.scanResults).find(r=>r.dtcs.length && (r.module==="BECM"||r.module==="BCCM"));
    if (worst) openSheet(renderModule(worst));
  }finally{ busy(false); }
}
$("btnScanCharge").onclick=()=>scan(false);
$("btnScanAll").onclick=()=>scan(true);

/* ---------- battery values ---------- */
function renderHero(vals){
  const g=k=>vals[k]?vals[k].v:null;
  const soc=g("State of charge"); if (soc!=null) $("bigSoc").textContent=Math.round(soc)+"%";
  const v=g("Pack voltage"); if (v!=null) $("bigVolt").textContent=Math.round(v)+" V";
  const t=g("Average battery temp"); if (t!=null) $("hvTemp").textContent=t.toFixed(1)+"°C";
  const h=g("Health (capacity)"); if (h!=null) $("hvHealth").textContent="Health "+Math.round(h)+"%";
  const o=g("Odometer"); if (o!=null) $("stOdo").textContent=kmToMi(o).toLocaleString("en-GB")+" mi";
  const lo=g("Lowest cell voltage"), hi=g("Highest cell voltage"); if (lo!=null&&hi!=null) $("stCells").textContent=Math.round((hi-lo)*1000)+" mV";
  if (soc!=null && v!=null) $("battSummary").textContent=Math.round(soc)+"% · "+Math.round(v)+" V"+(t!=null?" · "+t.toFixed(1)+"°C":"");
}
function renderLive(vals){
  renderHero(vals);
  const t=$("liveTable"); t.textContent="";
  for (const [k,x] of Object.entries(vals)){
    const tr=el("tr"); tr.appendChild(el("td",null,k));
    let txt = x? fmt(x.v)+" "+x.unit : "–";
    if (x && k==="Odometer") txt = kmToMi(x.v).toLocaleString("en-GB")+" mi";
    tr.appendChild(el("td",null,txt)); t.appendChild(tr);
  }
}
$("btnLive").onclick=async()=>{
  busy(true);
  try{ setStatus("Reading battery values","busy"); if(!await ensureConnected()) return; const v=await readDids(elm); S.lastLive={...(S.lastLive||{}),...v}; renderLive(S.lastLive); setStatus("Battery values read","on"); }
  catch(e){ setStatus(e.message,"bad"); }
  finally{ busy(false); }
};

/* ---------- charge watch ---------- */
let wakeLock=null;
function addEvent(text, kind="info"){
  const t=Date.now(); S.watch.events.push({t,text,kind});
  const li=el("li",kind==="mark"?"mark":kind==="fault"?"fault":null,new Date(t).toLocaleTimeString("en-GB")+"  "+text); $("events").prepend(li);
}
$("btnWatch").onclick=async()=>{
  watching=true; busy(true); sync();
  S.watch={events:[],rows:[],plugTime:null,maxCurrent:null}; $("events").textContent="";
  try{ wakeLock = await navigator.wakeLock?.request("screen"); }catch(e){}
  const prev={}; let n=0;
  addEvent("Watching started. Tap \"I've just plugged in\" the moment you plug the cable in.");
  sync();
  while(watching){
    n++;
    try{
      if (!await ensureConnected()){ break; }
      const v=await readWatchValues(elm); S.lastLive={...(S.lastLive||{}),...v}; renderLive(S.lastLive);
      const row={time:new Date().toISOString(), plugged: S.watch.plugTime?1:0}; for(const [k,x] of Object.entries(v)) row[k]=x?x.v:"";
      S.watch.rows.push(row);
      const cur=v["Pack current (+ = in)"];
      if (cur && (S.watch.maxCurrent==null || cur.v>S.watch.maxCurrent)) S.watch.maxCurrent=cur.v;
      $("watchInfo").textContent="Reading "+n+": "+(cur? "current "+fmt(cur.v)+" A":"current unknown")+(v["Pack voltage"]?", "+fmt(v["Pack voltage"].v)+" V":"");
      for (const name of ["BECM","BCCM"]){
        const m=moduleByName(name);
        const r=await elm.uds(m[0],"1902FF");
        if (r.error) continue;
        const b=r.bytes;
        for (let i=3;i+3<b.length;i+=4){
          const full=dtcName(b[i],b[i+1],b[i+2]).full, key=name+full, s=b[i+3];
          if (prev[key]===undefined && n>1) addEvent(name+": NEW fault "+full,"fault");
          else if (prev[key]!==undefined && (prev[key]&1)!==(s&1)) addEvent(name+": "+full+((s&1)?" is now FAILING":" stopped failing"),"fault");
          prev[key]=s;
        }
      }
      if (cur && Math.abs(cur.v)>2 && !S.watch.events.some(e=>e.text.startsWith("Current flowing"))) addEvent("Current flowing: "+fmt(cur.v)+" A");
    }catch(e){ addEvent("Read error: "+e.message); }
    await sleep(1500);
  }
  try{ await wakeLock?.release(); }catch(e){}
  addEvent("Watching stopped.");
  watching=false; busy(false);
};
$("btnStop").onclick=()=>{ watching=false; sync(); };
$("btnPlug").onclick=()=>{ if (!S.watch) return; S.watch.plugTime=Date.now(); addEvent("Plugged in (marked by you)","mark"); };

/* ---------- read-only sweep ---------- */
$("btnSweep").onclick=async()=>{
  const name=$("sweepModule").value, rangeKey=$("sweepRange").value, m=moduleByName(name);
  const ctrl=new AbortController(); sweepAbort=ctrl; busy(true);
  const tbl=$("sweepTable"); tbl.textContent=""; $("sweepBar").style.width="0";
  try{
    if(!await ensureConnected()) return;
    setStatus("Sweeping "+name,"busy");
    const res=await sweep(elm, m[0], SWEEP_RANGES[rangeKey], {signal:ctrl.signal, onProgress:(d,t,f)=>{ $("sweepBar").style.width=(100*d/t)+"%"; $("sweepInfo").textContent=d+" of "+t+" checked · "+f+" answered"; }});
    const old=S.sweeps[name];
    const prevVals = old ? old.cur : null;
    const changed = compareSweeps(prevVals, res.found);
    S.sweeps[name]={prev:prevVals||{}, cur:res.found, changed, stopped:res.stopped, at:Date.now()};
    const keys=Object.keys(res.found);
    $("sweepInfo").textContent=keys.length+" values answered"+(res.stopped?" (stopped early)":"")+(prevVals? " · "+changed.length+" changed since the last sweep":" · run it again in the other state to compare");
    for (const k of keys.sort((a,b)=>changed.includes(b)-changed.includes(a))){
      const tr=el("tr",changed.includes(k)?"chg":null); tr.appendChild(el("td",null,k)); tr.appendChild(el("td",null,res.found[k]+(changed.includes(k)?"  (was "+prevVals[k]+")":""))); tbl.appendChild(tr);
    }
    $("sweepBar").style.width=res.stopped?$("sweepBar").style.width:"100%"; setStatus("Sweep finished","on");
  }catch(e){ setStatus("Sweep error: "+e.message,"bad"); log("sweep error: "+e.message); }
  finally{ sweepAbort=null; busy(false); }
};
$("btnSweepStop").onclick=()=>{ sweepAbort && sweepAbort.abort(); };

/* ---------- report ---------- */
function reportFile(){ const name="ipace-report-"+new Date().toISOString().slice(0,16).replace(/[:T]/g,"-")+".txt"; return new File([buildReport({...S, now:Date.now()})],name,{type:"text/plain"}); }
function download(){ S.reportSaved=true; updateClearBtn(); const f=reportFile(); const a=el("a"); a.href=URL.createObjectURL(f); a.download=f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),5000); }
async function share(){ S.reportSaved=true; updateClearBtn(); const f=reportFile(); if (navigator.canShare && navigator.canShare({files:[f]})){ try{ await navigator.share({files:[f],title:"I-Pace fault report"}); }catch(e){} } else download(); }
$("btnSave").onclick=download; $("btnShare").onclick=share;

/* ---------- clear codes (explicit, one module at a time) ---------- */
for (const m of MODULES){ const o=document.createElement("option"); o.value=m[1]; o.textContent=m[1]+" · "+m[2]; $("clearModule").appendChild(o); }
function updateClearBtn(){ $("btnClear").disabled = busyNow || !(connected && $("clearSaved").checked && $("clearConfirm").value.trim().toUpperCase()==="CLEAR"); }
$("clearSaved").onchange=updateClearBtn; $("clearConfirm").oninput=updateClearBtn;
$("btnClear").onclick=async()=>{
  const mod=moduleByName($("clearModule").value);
  if (!S.reportSaved && !confirm("You haven't saved or shared a report in this session. Clear anyway? The codes and snapshots will be lost.")) return;
  if (!confirm("Clear all fault codes in "+mod[1]+" ("+mod[2]+")? This can't be undone.")) return;
  $("clearConfirm").value="";
  const out=$("clearOut"); out.textContent=""; busy(true);
  try{
    if(!await ensureConnected()) return;
    setStatus("Clearing codes in "+mod[1],"busy");
    const r=await elm.uds(mod[0], CLEAR_REQUEST, {allowClear:true});
    const when=new Date().toLocaleString("en-GB");
    if (r.error){ out.appendChild(el("p","err","The module didn't clear: "+r.error+". It may need a dealer tool.")); S.clearEvents.push(when+"  Clear "+mod[1]+" refused: "+r.error); setStatus("Clear refused by "+mod[1],"on"); return; }
    S.clearEvents.push(when+"  Cleared all codes in "+mod[1]);
    out.appendChild(el("p","clean","Cleared. Reading "+mod[1]+" again in 3 seconds…"));
    await sleep(3000);
    const res=await readModule(elm,mod); S.scanResults[mod[1]]=res; out.appendChild(renderModule(res));
    if (mod[3]) setHealth(mod[1], res.error? "none" : res.dtcs.length? "bad" : "ok");
    S.clearEvents.push(when+"  After clearing, "+mod[1]+" shows "+(res.error?res.error:res.dtcs.length+" code(s)"+(res.dtcs.length?": "+res.dtcs.map(d=>d.full).join(", "):"")));
    setStatus(res.dtcs.length? mod[1]+": "+res.dtcs.length+" code(s) came straight back" : mod[1]+": no codes after clearing","on");
  }catch(e){ out.appendChild(el("p","err","Error: "+e.message)); }
  finally{ busy(false); }
};

/* ---------- header, quick actions, misc ---------- */
$("ver").textContent="v"+VERSION;
if (demo) $("modeNote").textContent="Demo mode · simulated car";
try{ const n=localStorage.getItem("carName"); if(n) $("carName").textContent=n; }catch(e){}
$("carName").onclick=()=>{ const n=prompt("Name your car", $("carName").textContent); if(n&&n.trim()){ $("carName").textContent=n.trim().slice(0,24); try{localStorage.setItem("carName",n.trim().slice(0,24));}catch(e){} } };
$("btnInfo").onclick=()=>infoSheet("About",["Version "+VERSION+". An independent diagnostic tool for the I-Pace, using a Bluetooth OBD-II adapter. It is not made by or affiliated with Jaguar.",
  "Everything is read-only unless you use Clear fault codes. Module addresses and battery formulas come from the open-source OVMS project.",
  "Tip: add this page to your home screen (browser menu → Add to Home screen) and it will open even without signal."]);
$("qConnect").onclick=()=>$("btnConnect").click();
$("qScan").onclick=()=>{ $("healthList").scrollIntoView({behavior:"smooth",block:"center"}); $("btnScanCharge").click(); };
$("qBatt").onclick=()=>{ $("cardBatt").open=true; $("cardBatt").scrollIntoView({behavior:"smooth"}); $("btnLive").click(); };
$("qWatch").onclick=()=>{ $("cardWatch").open=true; $("cardWatch").scrollIntoView({behavior:"smooth"}); if(watching) $("btnStop").click(); else $("btnWatch").click(); };
sync();

/* Offline support */
if ("serviceWorker" in navigator && location.protocol==="https:") navigator.serviceWorker.register("sw.js").catch(e=>log("offline cache unavailable: "+e.message));

/* Exposed for automated browser tests */
window.__app = { S, get elm(){return elm;} };
