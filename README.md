# I-Pace Fault Reader

A web app for a Jaguar I-Pace that talks to a Bluetooth Low Energy OBD-II adapter (tested target: Veepeak OBDCheck BLE) from an Android browser, using Web Bluetooth. Chrome works as is; Brave needs `brave://flags` → "Web Bluetooth API" → Enabled.

Live at https://zo0pz.github.io/ipace-fault-reader-/ (add `?demo` to try it against a simulated car).

## What it does
- Reads fault codes (UDS 0x19 02/04/06) from the battery (BECM), charger (BCCM) and other modules, with decoded snapshot data and raw extended data.
- Reads high-voltage battery values (UDS 0x22) from the BECM.
- Charge watch: logs battery values and fault status every few seconds, with an "I've just plugged in" marker.
- Experimental read-only DID sweep of the charger or battery module, comparing two runs to find values that change when plugged in.
- Builds a report with a one-page summary for the garage, then full details and the adapter log.
- Reconnects automatically if Bluetooth drops. Installable and works offline after the first visit.

## Safety
Read-only by default. `js/safety.js` refuses everything except UDS 0x19 and 0x22 reads and a fixed list of adapter setup commands. The one exception is the optional "Clear fault codes" section (UDS 0x14 FFFFFF, one module at a time), which needs a ticked checkbox, typing CLEAR and two confirmations. All requests go through one queue (`js/elm.js`), so two can never overlap. It never writes settings or flashes software.

## Code
- `js/safety.js` request guard · `js/data.js` module addresses, DIDs, fault notes · `js/decode.js` parsing and decoding
- `js/elm.js` ELM327/UDS layer with command queue · `js/transport.js` Bluetooth and simulated car · `js/diag.js` scans, reads, sweep
- `js/report.js` report text · `js/app.js` interface · `sw.js` offline cache

Run the tests with `npm test` (Node 20+). They also run on every push via GitHub Actions.

Module addresses and battery value scaling come from the open-source [OVMS](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3) I-Pace module. Not affiliated with Jaguar.
