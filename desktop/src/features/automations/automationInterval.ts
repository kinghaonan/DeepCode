import i18n from "../../i18n";

export type AutomationIntervalUnit = "seconds" | "minutes" | "hours";

export interface AutomationIntervalInput {
  value: string;
  unit: AutomationIntervalUnit;
}

export type AutomationIntervalResult =
  | { intervalSeconds: number; error: null }
  | { intervalSeconds: null; error: string };

export const MIN_AUTOMATION_INTERVAL_SECONDS = 60;
export const MAX_AUTOMATION_INTERVAL_SECONDS = 31_622_400;

const DEFAULT_AUTOMATION_INTERVAL_SECONDS = 3_600;
const UNIT_SECONDS: Record<AutomationIntervalUnit, number> = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
};

const FRIENDLY_UNITS: readonly AutomationIntervalUnit[] = [
  "hours",
  "minutes",
  "seconds",
];

export function automationIntervalInput(
  intervalSeconds: number | null,
): AutomationIntervalInput {
  const seconds = intervalSeconds ?? DEFAULT_AUTOMATION_INTERVAL_SECONDS;
  const unit =
    FRIENDLY_UNITS.find((candidate) => seconds % UNIT_SECONDS[candidate] === 0) ??
    "seconds";
  return {
    value: String(seconds / UNIT_SECONDS[unit]),
    unit,
  };
}

export function automationIntervalSeconds(
  input: AutomationIntervalInput,
): AutomationIntervalResult {
  const value = input.value.trim();
  if (!/^\d+$/.test(value)) {
    return {
      intervalSeconds: null,
      error: i18n.t("automation.intervalPositiveWhole"),
    };
  }

  const amount = Number(value);
  const multiplier = UNIT_SECONDS[input.unit];
  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > Math.floor(Number.MAX_SAFE_INTEGER / multiplier)
  ) {
    return {
      intervalSeconds: null,
      error: i18n.t("automation.intervalTooLarge"),
    };
  }

  const intervalSeconds = amount * multiplier;
  if (intervalSeconds < MIN_AUTOMATION_INTERVAL_SECONDS) {
    return {
      intervalSeconds: null,
      error: i18n.t("automation.intervalMin"),
    };
  }
  if (intervalSeconds > MAX_AUTOMATION_INTERVAL_SECONDS) {
    return {
      intervalSeconds: null,
      error: i18n.t("automation.intervalMax"),
    };
  }
  return { intervalSeconds, error: null };
}

const UNIT_LABEL_KEYS: Record<AutomationIntervalUnit, string> = {
  seconds: "automation.unitSeconds",
  minutes: "automation.unitMinutes",
  hours: "automation.unitHours",
};

export function automationIntervalLabel(intervalSeconds: number | null): string {
  const input = automationIntervalInput(intervalSeconds);
  const amount = Number(input.value);
  const unit = i18n.t(UNIT_LABEL_KEYS[input.unit]).toLowerCase();
  const singular = i18n.language === "zh-CN" ? unit : unit.slice(0, -1);
  return `${input.value} ${amount === 1 ? singular : unit}`;
}
