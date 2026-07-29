import assert from "node:assert/strict";
import test from "node:test";
import { inferContactName } from "../app/lib/name.ts";

test("extracts initials and names while removing numeric decorations", () => {
  assert.equal(inferContactName("s.basu@ecmaindia.in"), "S Basu");
  assert.equal(inferContactName("123.suraj.sonnar@ikf.co.in"), "Suraj Sonnar");
  assert.equal(inferContactName("suraj777@ikf.co.in"), "Suraj");
});

test("keeps respectful fallback for generic and organization mailboxes", () => {
  assert.equal(inferContactName("info@company.com"), "Sir/Madam");
  assert.equal(inferContactName("cifadelhi2006@gmail.com"), "Sir/Madam");
  assert.equal(inferContactName("isapho@isapindia.org"), "Sir/Madam");
});

test("verified supplied names always take priority", () => {
  assert.equal(inferContactName("info@company.com", "Priya Shah"), "Priya Shah");
});
