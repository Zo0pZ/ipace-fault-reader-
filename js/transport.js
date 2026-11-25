/* Bluetooth Low Energy transport for ELM327 adapters, plus a simulated car for demo and tests. */
import { hex3 } from "./decode.js";
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const BLE_SERVICES = [0xfff0,0xffe0,0xffb0,0x18f0,0xbeef,"e7810a71-73ae-499d-8c15-faa9aef0c3f2"];

export class BleTransport {
  constructor(){ this.onDisconnect=null; this.buf=""; this.waiter=null; }
  get connected(){ return !!(this.device && this.device.gatt && this.device.gatt.connected && this.tx); }
  async open(){
    if (!navigator.bluetooth) throw new Error("This browser has no Web Bluetooth. Use Chrome on Android, opened from an https:// address.");
    this.device = await navigator.bluetooth.requestDevice({acceptAllDevices:true, optionalServices:BLE_SERVICES});
    this.device.addEventListener("gattserverdisconnected",()=>{ this.tx=null; if (this.waiter){ const w=this.waiter; this.waiter=null; w.reject(new Error("Adapter disconnected")); } this.onDisconnect && this.onDisconnect(); });
    await this._connectGatt();
    return this.device.name || "adapter";
  }
  async _connectGatt(){
    const server = await this.device.gatt.connect();
    this.rx=null; this.tx=null;
    const services = await server.getPrimaryServices();
    for (const s of services){
      for (const c of await s.getCharacteristics()){
        if (!this.rx && (c.properties.notify || c.properties.indicate)) this.rx=c;
        if (!this.tx && (c.properties.write || c.properties.writeWithoutResponse)) this.tx=c;
      }
      if (this.rx && this.tx) break;
    }
    if (!this.rx || !this.tx) throw new Error("Connected, but couldn't find the adapter's data channel. Is this the OBD adapter?");
    if (!this._listening){
      this._listening=true;
      this._onValue = e=>{
        this.buf += new TextDecoder().decode(e.target.value);
        if (this.buf.includes(">") && this.waiter){ const w=this.waiter; this.waiter=null; w.resolve(); }
      };
    }
    this.rx.removeEventListener("characteristicvaluechanged", this._onValue);
    this.rx.addEventListener("characteristicvaluechanged", this._onValue);
    await this.rx.startNotifications();
  }
  async reconnect(){ await this._connectGatt(); }
  async send(cmd, timeout=6000){
    if (!this.connected) throw new Error("Adapter disconnected");
    this.buf="";
    const done = new Promise((resolve,reject)=>{
      const w={resolve,reject}; this.waiter=w;
      setTimeout(()=>{ if(this.waiter===w){ this.waiter=null; reject(new Error("Adapter timed out on "+cmd)); } }, timeout);
    });
    const bytes = new TextEncoder().encode(cmd+"\r");
    for (let i=0;i<bytes.length;i+=20){
      const chunk=bytes.slice(i,i+20);
      if (this.tx.properties.writeWithoutResponse && this.tx.writeValueWithoutResponse) await this.tx.writeValueWithoutResponse(chunk);
      else await this.tx.writeValue(chunk);
    }
    await done;
    return this.buf.replace(">","");
  }
  close(){ try{ this.device.gatt.disconnect(); }catch(e){} }
}

/* Simulated I-Pace with an intermittent isolation fault that sets when "plugged in" (12 s after start).
   Options: dropAt (seconds) simulates one Bluetooth drop. */
export class DemoTransport {
  constructor(opts={}){ this.hdr=0x7E0; this.t0=Date.now(); this.isDemo=true; this.onDisconnect=null; this._up=true; this.dropAt=opts.dropAt; this.cleared={}; this.latency=opts.latency??25; }
  get connected(){ return this._up; }
  async open(){ return "Demo adapter (simulated car)"; }
  async reconnect(){ await sleep(300); this._up=true; }
  close(){}
  async send(cmd){
    await sleep(this.latency);
    const t=(Date.now()-this.t0)/1000;
    if (this.dropAt!=null && t>this.dropAt && !this._dropped){ this._dropped=true; this._up=false; setTimeout(()=>this.onDisconnect&&this.onDisconnect()); throw new Error("Adapter disconnected"); }
    if (!this._up) throw new Error("Adapter disconnected");
    if (cmd.startsWith("AT")){ if(cmd.startsWith("ATSH")) this.hdr=parseInt(cmd.slice(4),16); return cmd==="ATZ"?"ELM327 v2.2\r\r":cmd==="ATI"?"ELM327 v2.2\r\r":"OK\r\r"; }
    const plugged = t>12, H=this.hdr;
    const iso = hex => {
      const b=hex.match(/../g); if(b.length<=7) return b.join(" ")+"\r\r";
      let out=hex3(b.length)+"\r0: "+b.slice(0,6).join(" ")+"\r"; let i=6,n=1;
      while(i<b.length){ out+=(n%16).toString(16).toUpperCase()+": "+b.slice(i,i+7).join(" ")+"\r"; i+=7;n++; } return out+"\r"; };
    if (cmd==="14FFFFFF"){ this.cleared[H]=true; return "54\r\r"; }
    const cl = this.cleared[H];
    if (cmd==="1902FF"){
      if (cl && H===0x7E4) return iso("5902FF"+(plugged?"0AA60009":""));
      if (cl) return iso("5902FF");
      if (H===0x7E4) return iso("5902FF"+"0AA600"+(plugged?"09":"08")+"F00100"+"08");
      if (H===0x7E5) return iso("5902FF"+"0D9400"+"08"+"C06482"+"09");
      if (H===0x726) return iso("5902FF"+"947972"+"08");
      if (H===0x7E0||H===0x733||H===0x753) return iso("5902FF");
      return "NO DATA\r\r";
    }
    if (cmd.startsWith("1904")) return iso("5904"+cmd.slice(4,10)+"08"+"01"+"03"+"DD01"+"00F2A1"+"4910"+"1B58"+"490F"+"8D2C"+"02"+"01"+"ABCD"+"0102");
    if (cmd.startsWith("1906")) return iso("5906"+cmd.slice(4,10)+"08"+"01"+"07"+"02"+"03");
    if (cmd.startsWith("22")){
      const did=cmd.slice(2,6);
      if (H===0x7E4){
        const v={ "4910":"1B58","490F":plugged?"8E10":"8D2C","490C":plugged&&t<20?"8050":"8000","4904":"0F3C","4903":"0F46",
          "4906":"6E","4905":"74","4907":"71","4918":"B6","4915":"BE","4913":"1D4C","DD01":"00F2A1","F190":"44454D4F30303030303030303030303030",
          "4A20": plugged?"0004":"FFFF" /* pretend isolation resistance (kΩ) */ }[did];
        return v? iso("62"+did+v) : "7F 22 31\r\r";
      }
      if (H===0x7E5){
        const v={ "4810": plugged?"00F0":"0000" /* pretend AC volts */, "4811": plugged?"20":"00", "4812":"01" }[did];
        return v? iso("62"+did+v) : "7F 22 31\r\r";
      }
    }
    return "NO DATA\r\r";
  }
}
