# I-Pace Fault Reader

A read-only web app for a Jaguar I-Pace. It talks to a Bluetooth Low Energy OBD-II adapter (tested target: Veepeak OBDCheck BLE) from Chrome on Android, using Web Bluetooth.

- Reads fault codes (UDS 0x19 02/04/06) from the battery (BECM), charger (BCCM) and other modules, including snapshot and extended data.
- Reads high-voltage battery values (UDS 0x22) from the BECM.
- Watches the battery and charger modules while the car is plugged in and logs when faults start failing.
- Saves or shares a text report.

**Read-only by default:** the code refuses everything except UDS 0x19 and 0x22 read requests and a fixed list of adapter setup commands. The one exception is an optional "Clear fault codes" section (UDS 0x14 FFFFFF, one module at a time), which needs a ticked checkbox, typing CLEAR and two confirmations. It never writes settings or flashes software.

Open the page with `?demo` to try it against a simulated car.

Module addresses and battery value scaling come from the open-source [OVMS](https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3) I-Pace module.
