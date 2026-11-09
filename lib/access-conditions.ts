/**
 * Phase 4.31 — OSM conditional access ("motor_vehicle:conditional=no @ (20:00 - 07:00)") evaluated
 * at a departure time in Milan (Europe/Rome). Only what the tags state is applied; a condition
 * this parser cannot read is reported as unknown, never guessed.
 *
 * Supported: weekday sets and ranges (Mo-Fr, Sa, Mo,We), month ranges (Oct-Apr), one or more
 * hour ranges (07:30-09:30,12:30-24:00), ranges past midnight (20:00-07:00, 20:00-31:00),
 * "PH off" (public holidays are not known, so a "PH" rule is treated as not applying) and user
 * classes (residents, permit_holder, disabled…), which only a person's own authorisation answers.
 */
export type DepartureTime = {
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
  /** 1 = January … 12 = December */
  month: number;
  /** Minutes after local midnight. */
  minutes: number;
};

const ROME = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Rome",
  weekday: "short",
  month: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const WEEKDAY_EN: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Local Milan time of an instant. */
export function romeDeparture(instant: Date): DepartureTime {
  const parts = Object.fromEntries(ROME.formatToParts(instant).map((part) => [part.type, part.value]));
  return { weekday: WEEKDAY_EN[parts.weekday] ?? 0, month: Number(parts.month), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/** "2026-11-08T21:30" read as Milan local time (the form the app sends); null when malformed. */
export function parseLocalDeparture(value: string | null): DepartureTime | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const weekday = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
  return { weekday, month: mo, minutes: h * 60 + mi };
}

export function formatDeparture(time: DepartureTime) {
  const hh = String(Math.floor(time.minutes / 60)).padStart(2, "0");
  const mm = String(time.minutes % 60).padStart(2, "0");
  return `${["lun", "mar", "mer", "gio", "ven", "sab", "dom"][time.weekday]} ${hh}:${mm}`;
}

type HourRange = { from: number; to: number };
type TimeRule = { months: Set<number> | null; weekdays: Set<number> | null; holidayOnly: boolean; off: boolean; hours: HourRange[] };
export type Condition =
  | { kind: "time"; rules: TimeRule[] }
  | { kind: "class"; name: string }
  | { kind: "unknown"; text: string };
export type ConditionalRule = { value: string; condition: Condition };

/** Splits on `;` outside parentheses. */
function splitTopLevel(text: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function rangeSet(text: string, names: string[], offset: number): Set<number> | null {
  const set = new Set<number>();
  for (const piece of text.split(",")) {
    const [a, b] = piece.split("-").map((value) => names.indexOf(value.trim()));
    if (a < 0 || (piece.includes("-") && b < 0)) return null;
    if (b === undefined || b < 0) set.add(a + offset);
    else for (let i = a; ; i = (i + 1) % names.length) { set.add(i + offset); if (i === b) break; }
  }
  return set;
}

function parseTimeRule(text: string): TimeRule | null {
  // "Mo-Fr 07:30-09:30", "Oct-Apr 22:00-06:30", "20:00 - 07:00", "PH off", "Su 00:00-24:00"
  const normalised = text.replace(/\s*-\s*/g, "-").replace(/\s*,\s*/g, ",").trim();
  const tokens = normalised.split(/\s+/);
  const rule: TimeRule = { months: null, weekdays: null, holidayOnly: false, off: false, hours: [] };
  for (const token of tokens) {
    if (token === "off") { rule.off = true; continue; }
    if (token === "PH") { rule.holidayOnly = true; continue; }
    if (/^\d{1,2}:\d{2}-\d{1,2}:\d{2}(,\d{1,2}:\d{2}-\d{1,2}:\d{2})*$/.test(token)) {
      for (const span of token.split(",")) {
        const [from, to] = span.split("-").map((time) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; });
        if (from > 24 * 60 || to > 48 * 60) return null;
        rule.hours.push({ from, to });
      }
      continue;
    }
    const months = rangeSet(token, MONTHS, 1);
    if (months && /^[A-Z][a-z]{2}/.test(token) && MONTHS.includes(token.slice(0, 3))) { rule.months = months; continue; }
    const weekdays = rangeSet(token, WEEKDAYS, 0);
    if (weekdays) { rule.weekdays = weekdays; continue; }
    return null;
  }
  if (!rule.holidayOnly && !rule.off && rule.hours.length === 0 && !rule.weekdays && !rule.months) return null;
  return rule;
}

export function parseConditional(value: string): ConditionalRule[] {
  return splitTopLevel(value).map((part) => {
    const at = part.indexOf("@");
    if (at < 0) return { value: part.trim().toLowerCase(), condition: { kind: "unknown", text: "" } as Condition };
    const ruleValue = part.slice(0, at).trim().toLowerCase();
    const text = part.slice(at + 1).trim().replace(/^\(/, "").replace(/\)$/, "").trim();
    if (/^[a-z_]+$/.test(text)) return { value: ruleValue, condition: { kind: "class", name: text } as Condition };
    if (/\b(AND|weight|length|wet|snow|stay|maxweight)\b/i.test(text)) return { value: ruleValue, condition: { kind: "unknown", text } as Condition };
    const rules = splitTopLevel(text).map(parseTimeRule);
    if (rules.some((rule) => rule === null)) return { value: ruleValue, condition: { kind: "unknown", text } as Condition };
    return { value: ruleValue, condition: { kind: "time", rules: rules as TimeRule[] } as Condition };
  });
}

function dayMatches(rule: TimeRule, weekday: number, month: number) {
  return (!rule.weekdays || rule.weekdays.has(weekday)) && (!rule.months || rule.months.has(month));
}

/** Whether a time condition holds at `time`. Public holidays are unknown, so PH-only rules do not. */
export function conditionActive(condition: Condition, time: DepartureTime): boolean | null {
  if (condition.kind !== "time") return null;
  let active = false;
  for (const rule of condition.rules) {
    if (rule.holidayOnly) continue;
    const hours = rule.hours.length ? rule.hours : [{ from: 0, to: 24 * 60 }];
    let matched = false;
    for (const { from, to } of hours) {
      const end = to <= from ? to + 24 * 60 : to;
      // Same-day part, then the part after midnight, which belongs to the previous day's rule.
      if (dayMatches(rule, time.weekday, time.month) && time.minutes >= from && time.minutes < Math.min(end, 24 * 60)) matched = true;
      const previousDay = (time.weekday + 6) % 7;
      if (end > 24 * 60 && time.minutes < end - 24 * 60 && dayMatches(rule, previousDay, time.month)) matched = true;
    }
    if (matched) active = !rule.off;
  }
  return active;
}

export type EffectiveAccess = {
  /** The value that applies now, e.g. "no", "permit", "yes"; null when no tag of these keys is set. */
  value: string | null;
  /** The key that decided it, e.g. "motor_vehicle:conditional". */
  key: string | null;
  /** The condition was written in a way this parser cannot evaluate. */
  unknownCondition: boolean;
  /** The decisive value came from a time window active now (or inactive, for "yes @ window"). */
  timed: boolean;
  /** A user class (residents, permit_holder…) is exempt: a permit situation. */
  exemptClasses: string[];
};

/**
 * The access value that applies to a mode at `time`, walking keys from most to least specific
 * (motorcar → motor_vehicle → vehicle → access). A conditional value active now overrides its
 * key's plain value. "yes @ (07:00 - 20:00)" on a way with no plain restriction means the way is
 * closed outside that window: the tag exists only because it is.
 */
export function effectiveAccess(tags: Record<string, string> | undefined, keys: string[], time: DepartureTime): EffectiveAccess {
  const result: EffectiveAccess = { value: null, key: null, unknownCondition: false, timed: false, exemptClasses: [] };
  if (!tags) return result;
  for (const key of keys) {
    const conditional = tags[`${key}:conditional`];
    const plain = tags[key]?.trim().toLowerCase();
    if (conditional) {
      const rules = parseConditional(conditional);
      for (const rule of rules) if (rule.condition.kind === "class" && ["yes", "designated", "permissive"].includes(rule.value)) result.exemptClasses.push(rule.condition.name);
      let decided: string | null = null;
      let onlyAllowingWindows = true;
      for (const rule of rules) {
        if (rule.condition.kind === "unknown") { result.unknownCondition = true; continue; }
        if (rule.condition.kind === "class") continue;
        if (!["yes", "designated", "permissive"].includes(rule.value)) onlyAllowingWindows = false;
        if (conditionActive(rule.condition, time)) decided = rule.value;
      }
      if (decided) return { ...result, value: decided, key: `${key}:conditional`, timed: true };
      const timeRules = rules.filter((rule) => rule.condition.kind === "time");
      if (!plain && timeRules.length > 0 && onlyAllowingWindows) return { ...result, value: "no", key: `${key}:conditional`, timed: true };
      if (result.unknownCondition && !plain) return { ...result, key: `${key}:conditional` };
    }
    if (plain) return { ...result, value: plain, key };
  }
  return result;
}
