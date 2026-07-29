import assert from "node:assert/strict";
import test from "node:test";
import { buildCampaignSchedule } from "../app/lib/schedule.ts";

const policy = {
  daily_limit: 25,
  sending_window_start: "10:00",
  sending_window_end: "17:00",
};

const indiaTime = (day, hour, minute = 0) => new Date(Date.UTC(2026, 6, day, hour, minute) - 330 * 60_000);

test("one email per batch applies the configured gap to every email", () => {
  const times = buildCampaignSchedule(indiaTime(30, 10), 3, 1, 5, policy);
  assert.deepEqual(times.map((time) => time.toISOString()), [
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10, 5).toISOString(),
    indiaTime(30, 10, 10).toISOString(),
  ]);
});

test("two or three emails can share one batch before the gap", () => {
  const pairs = buildCampaignSchedule(indiaTime(30, 10), 5, 2, 3, policy);
  assert.deepEqual(pairs.map((time) => time.toISOString()), [
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10, 3).toISOString(),
    indiaTime(30, 10, 3).toISOString(),
    indiaTime(30, 10, 6).toISOString(),
  ]);

  const threes = buildCampaignSchedule(indiaTime(30, 10), 4, 3, 2, policy);
  assert.deepEqual(threes.map((time) => time.toISOString()), [
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10).toISOString(),
    indiaTime(30, 10, 2).toISOString(),
  ]);
});

test("daily limits move remaining emails to the next sending day", () => {
  const times = buildCampaignSchedule(indiaTime(30, 16, 59), 4, 2, 5, { ...policy, daily_limit: 2 });
  assert.deepEqual(times.map((time) => time.toISOString()), [
    indiaTime(30, 16, 59).toISOString(),
    indiaTime(30, 16, 59).toISOString(),
    indiaTime(31, 10).toISOString(),
    indiaTime(31, 10).toISOString(),
  ]);
});

test("campaigns cannot start outside the configured India sending window", () => {
  assert.throws(
    () => buildCampaignSchedule(indiaTime(30, 9, 59), 1, 1, 5, policy),
    /Choose a start time inside/,
  );
});
