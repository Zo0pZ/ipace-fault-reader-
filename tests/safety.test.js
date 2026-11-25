import test from "node:test";
import assert from "node:assert/strict";
import { assertReadOnly, checkRequest, assertAdapterCommand, CLEAR_REQUEST } from "../js/safety.js";

test("allows only the read requests the app uses", ()=>{
  for (const h of ["1902FF","1904123456FF","1906ABCDEFFF","22F190","224910","22dd01"]) assert.doesNotThrow(()=>assertReadOnly(h), h);
});
test("blocks every write, control, session or security request", ()=>{
  const bad=["14FFFFFF","2E491000","2F4910030000","3101FF00","1101","1103","1003","1002","2701","2702AABB","3D00","34","36","37","85","28","0400",
    "190201","1902","1904","22","2249","224910F190","19021234","1A90",""];
  for (const h of bad) assert.throws(()=>assertReadOnly(h), undefined, h);
});
test("clear request only passes when explicitly allowed, and only exactly", ()=>{
  assert.throws(()=>checkRequest(CLEAR_REQUEST));
  assert.equal(checkRequest(CLEAR_REQUEST,true),"14FFFFFF");
  assert.throws(()=>checkRequest("14FFFF00",true));
  assert.throws(()=>checkRequest("2E491000",true));
  assert.equal(checkRequest("22f190",true),"22F190");
});
test("adapter commands are whitelisted", ()=>{
  for (const c of ["ATZ","ATE0","ATSP6","ATSH7E4","ATCRA7EC","ATFCSH7E4","ATST32","ATSTFF","ATI"]) assert.doesNotThrow(()=>assertAdapterCommand(c), c);
  for (const c of ["ATMA","ATBD","ATPP0CSV01","ATWS","ATSP0","ATSH18DAF1","STDI","ATCSM0"]) assert.throws(()=>assertAdapterCommand(c), undefined, c);
});
