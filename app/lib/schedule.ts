export function buildCampaignSchedule(
  start: Date,
  count: number,
  batchSize: number,
  gapMinutes: number,
  policy: Record<string, any>,
) {
  const indiaOffsetMinutes = 330;
  const windowStart = parseClock(String(policy.sending_window_start || "10:00"));
  const windowEnd = parseClock(String(policy.sending_window_end || "17:00"));
  if (windowEnd <= windowStart) throw new Error("The sending window end must be later than its start.");
  if (!insideIndiaWindow(start, String(policy.sending_window_start || "10:00"), String(policy.sending_window_end || "17:00"))) {
    throw new Error(`Choose a start time inside the ${policy.sending_window_start || "10:00"}–${policy.sending_window_end || "17:00"} Asia/Kolkata sending window.`);
  }

  const safeBatchSize = Math.max(1, Math.min(count, Math.floor(Number(batchSize) || 1)));
  const safeGapMinutes = Math.max(1, Math.min(60, Math.floor(Number(gapMinutes) || 1)));
  const dailyLimit = Math.max(1, Math.min(1000, Number(policy.daily_limit || 25)));
  const dayCounts = new Map<string, number>();
  const times: Date[] = [];
  let cursor = new Date(start);

  for (let index = 0; index < count; index += 1) {
    while (true) {
      const shifted = new Date(cursor.getTime() + indiaOffsetMinutes * 60_000);
      const year = shifted.getUTCFullYear();
      const month = shifted.getUTCMonth();
      const day = shifted.getUTCDate();
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
      const dayKey = `${year}-${month + 1}-${day}`;
      const used = dayCounts.get(dayKey) || 0;

      if (minutes < windowStart) {
        cursor = indiaLocalDate(year, month, day, windowStart, indiaOffsetMinutes);
        continue;
      }
      if (minutes > windowEnd || used >= dailyLimit) {
        cursor = indiaLocalDate(year, month, day + 1, windowStart, indiaOffsetMinutes);
        continue;
      }

      times.push(new Date(cursor));
      dayCounts.set(dayKey, used + 1);
      const batchComplete = (index + 1) % safeBatchSize === 0;
      if (batchComplete || used + 1 >= dailyLimit) cursor = new Date(cursor.getTime() + safeGapMinutes * 60_000);
      break;
    }
  }

  return times;
}

export function insideIndiaWindow(date: Date, start: string, end: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return parts >= start && parts <= end;
}

function parseClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("The configured sending window is invalid.");
  }
  return hours * 60 + minutes;
}

function indiaLocalDate(year: number, month: number, day: number, minutes: number, offsetMinutes: number) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return new Date(Date.UTC(year, month, day, hours, mins) - offsetMinutes * 60_000);
}
