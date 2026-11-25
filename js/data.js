/* I-Pace module addresses and BECM data identifiers.
   Source: the open-source OVMS project (vehicle_jaguaripace). Replies come from tx + 8. */
export const MODULES = [
  [0x7E4,"BECM","Battery Energy Control Module (HV battery)",true],
  [0x7E5,"BCCM","Battery Charger Control Module (on-board charger, charge port)",true],
  [0x7E0,"PCM","Powertrain Control Module",true],
  [0x726,"GWM","Gateway / Body Control Module",true],
  [0x753,"DCDC","DC-DC Converter",true],
  [0x747,"EPIC-F","Front Electric Power Inverter",true],
  [0x746,"EPIC-R","Rear Electric Power Inverter",true],
  [0x733,"HVAC","Climate Control (includes HV heater control)",true],
  [0x785,"RHVAC","Rear Climate Control",false],
  [0x7E2,"BBM","Brake Booster Module",false],
  [0x7E6,"ABS","Anti-lock Braking",false],
  [0x720,"IPC","Instrument Cluster",false],
  [0x754,"TCU","Telematics",false],
  [0x792,"ATCM","Drive Switchpack",false],
  [0x710,"CHCM","Chassis Control",false],
  [0x730,"PSCM","Power Steering",false],
  [0x731,"RFA","Remote Function Actuator",false],
  [0x732,"GSM","Gear Shift Module",false],
  [0x734,"HCM","Headlamp Module",false],
  [0x7C3,"HCM-B","Headlamp Module B",false],
  [0x736,"PAM","Parking Aid",false],
  [0x737,"RCM","Restraints (airbags)",false],
  [0x740,"DDM","Driver Door",false],
  [0x741,"PDM","Passenger Door",false],
  [0x742,"DRDM","Driver Rear Door",false],
  [0x743,"PRDM","Passenger Rear Door",false],
  [0x744,"DSM","Driver Seat",false],
  [0x7A3,"PSM","Passenger Seat",false],
  [0x751,"TPMS","Tyre Pressure",false],
  [0x752,"OMM","Occupant Monitoring",false],
  [0x764,"ASCM","Adaptive Cruise",false],
  [0x775,"RGTM","Tailgate",false],
  [0x797,"SASM","Steering Angle",false],
  [0x7A2,"IDMA","Interactive Display",false],
  [0x7A4,"AAM","Audio Amplifier",false],
  [0x7B1,"CMR","Rear Camera",false],
  [0x7B2,"HUD","Head-up Display",false],
  [0x7B3,"IMC","Infotainment",false],
  [0x706,"IPMA","Image Processing",false],
  [0x716,"SDLC","Unknown module",false],
  [0x7C4,"SODL","Blind Spot Left",false],
  [0x7C6,"SODR","Blind Spot Right",false],
];
export const moduleByName = n => MODULES.find(m=>m[1]===n);

const u16 = b => (b[0]<<8)|b[1];
/* [did, name, unit, bytes, decode] */
export const BECM_DIDS = [
  [0x4910,"State of charge","%",2,b=>u16(b)/100],
  [0x490F,"Pack voltage","V",2,b=>u16(b)/100],
  [0x490C,"Pack current (+ = in)","A",2,b=>(u16(b)-0x8000)/40],
  [0x4904,"Lowest cell voltage","V",2,b=>u16(b)/1000],
  [0x4903,"Highest cell voltage","V",2,b=>u16(b)/1000],
  [0x4906,"Coolest battery temp","°C",1,b=>b[0]/2-40],
  [0x4905,"Warmest battery temp","°C",1,b=>b[0]/2-40],
  [0x4907,"Average battery temp","°C",1,b=>b[0]/2-40],
  [0x4918,"Health (capacity)","%",1,b=>b[0]/2],
  [0x4915,"Health (power)","%",1,b=>b[0]/2],
  [0x4913,"Max regen","kW",2,b=>u16(b)/100],
  [0xDD01,"Odometer","km",3,b=>(b[0]<<16)|(b[1]<<8)|b[2]],
];
/* Fewer values per cycle while watching a charge, so readings come quickly */
export const WATCH_DIDS = [0x4910,0x490F,0x490C,0x4904,0x4903,0x4907];

/* DIDs we can decode inside fault snapshots (known lengths). Anything else stops decoding. */
export const SNAPSHOT_DIDS = Object.fromEntries([
  ...BECM_DIDS.map(([did,name,unit,len,f])=>[did,{name,unit,len,f}]),
  [0xDD04,{name:"Cabin temp",unit:"°C",len:1,f:b=>b[0]-40}],
]);

export const DTC_NOTES = {
  "P0AA6":"High-voltage isolation fault: the car has measured a leak between the high-voltage system and the body. The car blocks charging while it is present. It needs HV insulation testing by a trained technician.",
  "P0D94":"Charge-port (coupler) lock circuit performance: the cable lock didn't behave as expected.",
  "U3001":"Control module improper shutdown: the module lost power or didn't shut down cleanly.",
  "U0064":"Communication on vehicle bus E: messages missing or not updating.",
  "U0080":"Communication on vehicle bus F: messages missing or not updating.",
  "B1479":"Power supply distribution box actuator stuck open.",
  "P0AA1":"HV battery positive contactor stuck closed.",
  "P0AA4":"HV battery negative contactor stuck closed.",
  "P0A0A":"High-voltage interlock (HVIL) circuit fault.",
  "P0A0D":"High-voltage interlock circuit high.",
  "P0A94":"DC-DC converter performance.",
};
export function noteParts(code){
  const n=DTC_NOTES[code];
  if(!n) return ["Fault code stored","No plain-English description in this app. Jaguar can look it up from the code."];
  const i=n.indexOf(":");
  return [n.slice(0,i), n.slice(i+1).trim().replace(/^./,c=>c.toUpperCase())];
}

/* Read-only DID sweep ranges */
export const SWEEP_RANGES = {
  quick: [[0x4800,0x4AFF]],
  full:  [[0x4000,0x4FFF],[0xD000,0xD1FF],[0xDD00,0xDDFF]],
};
