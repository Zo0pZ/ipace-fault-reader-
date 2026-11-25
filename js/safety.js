/* Safety guard. Every request to the car passes through here.
   Only UDS reads are allowed, plus one explicit clear request used by the Clear section. */

/* Adapter (ELM327) setup commands the app may send. Nothing else. */
export const ALLOWED_AT = /^AT(Z|E0|L0|S0|H0|SP6|AT1|STFF|ST32|SH[0-9A-F]{3}|CRA[0-9A-F]{3}|FCSH[0-9A-F]{3}|FCSD300000|FCSM1|RV|I|DPN)$/;

/* The ONLY non-read request: ClearDiagnosticInformation (0x14) for all groups. */
export const CLEAR_REQUEST = "14FFFFFF";

export function assertAdapterCommand(cmd){
  if (!ALLOWED_AT.test(cmd)) throw new Error("Blocked adapter command "+cmd);
}

/* Throws unless hex is an allowed read request. */
export function assertReadOnly(hex){
  hex = String(hex).toUpperCase();
  const sid = hex.slice(0,2);
  if (sid === "22") { if (!/^22[0-9A-F]{4}$/.test(hex)) throw new Error("Blocked: malformed read"); return; }
  if (sid === "19") { if (!/^19(02FF|04[0-9A-F]{6}FF|06[0-9A-F]{6}FF)$/.test(hex)) throw new Error("Blocked: unsupported fault-read request"); return; }
  throw new Error("Blocked: this app only sends read requests (service "+sid+" refused)");
}

/* Gate used by the UDS layer. allowClear must be passed explicitly, and only the exact clear request passes. */
export function checkRequest(hex, allowClear=false){
  hex = String(hex).toUpperCase();
  if (allowClear && hex === CLEAR_REQUEST) return hex;
  assertReadOnly(hex);
  return hex;
}
