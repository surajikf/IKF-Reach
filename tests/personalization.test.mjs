import assert from "node:assert/strict";
import test from "node:test";
import {
  hasPersonalizationPlaceholder,
  renderPersonalizedSubject,
  replacePersonalizationPlaceholders,
} from "../app/lib/personalization.ts";

test("single-curly association aliases personalize each campaign subject", () => {
  const result = renderPersonalizedSubject(
    "AI Native Thinking Masterclass: An Opportunity for {ASSOCIATION NAME} Members",
    { company: "Automotive Research Association of India (ARAI)" },
  );
  assert.equal(
    result,
    "AI Native Thinking Masterclass: An Opportunity for Automotive Research Association of India (ARAI) Members",
  );
  assert.doesNotMatch(result, /[{}]/);
});

test("double-curly company aliases personalize without duplicating the company", () => {
  const result = renderPersonalizedSubject("{{company}} - AI Native Thinking Masterclass", { company: "IKF" });
  assert.equal(result, "IKF - AI Native Thinking Masterclass");
});

test("subjects without a company field keep the organization-first convention", () => {
  const result = renderPersonalizedSubject("AI Native Thinking Masterclass", { company: "IKF" });
  assert.equal(result, "IKF - AI Native Thinking Masterclass");
});

test("subject and body personalization recognize aliases and remove unresolved fields", () => {
  const result = replacePersonalizationPlaceholders(
    "Dear {{recipient name}}, {ORGANISATION NAME} works in {{industry}}. {{missing_value}}",
    { name: "Suraj", company: "IKF", industry: "Technology" },
  );
  assert.equal(result, "Dear Suraj, IKF works in Technology. ");
  assert.equal(hasPersonalizationPlaceholder("{ASSOCIATION NAME}"), true);
  assert.doesNotMatch(result, /[{}]/);
});
