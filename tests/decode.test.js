import test from "node:test";
import assert from "node:assert/strict";
import { dtcName, statusWords, parseElm, interpret, parseDtcList, decodeSnapshot, snapshotText } from "../js/decode.js";

test("fault code names match the garage report", ()=>{
  assert.equal(dtcName(0x0A,0xA6,0x00).full,"P0AA6-00");
  assert.equal(dtcName(0xF0,0x01,0x00).full,"U3001-00");
  assert.equal(dtcName(0x0D,0x94,0x00).full,"P0D94-00");
  assert.equal(dtcName(0xC0,0x64,0x82).full,"U0064-82");
  assert.equal(dtcName(0x94,0x79,0x72).full,"B1479-72");
  assert.equal(dtcName(0x41,0x23,0x00).full,"C0123-00");
});
test("status byte words", ()=>{
  assert.deepEqual(statusWords(0x09),["failing now","confirmed"]);
  assert.deepEqual(statusWords(0x00),[]);
});
test("parses single, multi-frame, pending and error replies", ()=>{
  assert.deepEqual(parseElm("62 49 10 1B 58\r\r>").bytes,[0x62,0x49,0x10,0x1B,0x58]);
  assert.deepEqual(parseElm("00B\r0: 59 02 FF 0A A6 00\r1: 09 F0 01 00 08 00 00\r\r").bytes,[0x59,2,0xFF,0x0A,0xA6,0,9,0xF0,1,0,8]);
  assert.deepEqual(parseElm("7F 22 78\r62 49 10 1B 58\r").bytes,[0x62,0x49,0x10,0x1B,0x58]);
  assert.deepEqual(parseElm("00B\r0:5902FF0AA600\r1:09F00100080000\r").bytes.length,11);
  assert.equal(parseElm("NO DATA\r").error,"NO DATA");
  assert.equal(parseElm("CAN ERROR").error,"CAN ERROR");
  assert.equal(parseElm("").error,"empty reply");
});
test("interpret handles refusals and mismatched replies", ()=>{
  assert.match(interpret("7F 22 31","224910").error,/not available/);
  assert.equal(interpret("7F 22 31","224910").nrc,0x31);
  assert.match(interpret("59 02 FF","224910").error,/unexpected/);
  assert.ok(interpret("62 49 10 1B 58","224910").bytes);
});
test("DTC list parsing", ()=>{
  const l=parseDtcList([0x59,2,0xFF,0x0A,0xA6,0,0x09,0xF0,1,0,0x08]);
  assert.equal(l.length,2); assert.equal(l[0].full,"P0AA6-00"); assert.deepEqual(l[0].words,["failing now","confirmed"]); assert.equal(l[1].full,"U3001-00");
  assert.equal(parseDtcList([0x59,2,0xFF]).length,0);
});
test("snapshot decoding is structured and stops at unknown data", ()=>{
  const b=[0x59,4,0x0A,0xA6,0,8, 1,3, 0xDD,1,0x00,0xF2,0xA1, 0x49,0x10,0x1B,0x58, 0x49,0x0F,0x8D,0x2C, 2,1, 0xAB,0xCD,1,2];
  const s=decodeSnapshot(b);
  assert.equal(s.records.length,2);
  assert.equal(s.records[0].items.length,3);
  assert.equal(s.records[0].items[0].value,62113);
  assert.equal(s.records[0].items[1].value,70);
  assert.equal(s.complete,false);
  assert.equal(s.undecoded,"AB CD 01 02");
  assert.deepEqual(snapshotText(s),["Odometer 38,595 mi","State of charge 70 %","Pack voltage 361.40 V"]);
  const ok=decodeSnapshot([0x59,4,0x0A,0xA6,0,8,1,1,0x49,0x10,0x1B,0x58]);
  assert.equal(ok.complete,true);
  assert.equal(decodeSnapshot([0x62,1]).complete,false);
});
