import { describe, expect, it } from "vitest";

import enUS from "./locales/en-US";
import zhCN from "./locales/zh-CN";

type TranslationTree = {
  [key: string]: string | TranslationTree;
};

/** Recursively flatten a translation tree into dotted leaf keys. */
function flattenKeys(root: unknown, prefix = ""): string[] {
  if (typeof root !== "object" || root === null) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      keys.push(path);
    } else if (typeof value === "object" && value !== null) {
      keys.push(...flattenKeys(value, path));
    }
  }
  return keys;
}

/** Flatten a translation tree into a map of dotted key → leaf string. */
function flattenValues(root: unknown, prefix = ""): Map<string, string> {
  const values = new Map<string, string>();
  if (typeof root !== "object" || root === null) return values;
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      values.set(path, value);
    } else if (typeof value === "object" && value !== null) {
      for (const [childPath, childValue] of flattenValues(value, path)) {
        values.set(childPath, childValue);
      }
    }
  }
  return values;
}

const PLURAL_SUFFIXES = ["_one", "_other"] as const;

/**
 * Collapse i18next plural variants (`key_one` / `key_other`) onto the base key
 * so English plural pairs compare equal to the single Chinese key.
 */
function collapsePlural(key: string): string {
  for (const suffix of PLURAL_SUFFIXES) {
    if (key.endsWith(suffix)) return key.slice(0, -suffix.length);
  }
  return key;
}

/** Extract i18next interpolation variable names (`{{var}}`) from a string. */
function interpolationVariables(value: string): string[] {
  return [...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
}

const en = enUS as unknown as TranslationTree;
const zh = zhCN as unknown as TranslationTree;

describe("translation dictionaries", () => {
  it("defines the exact same key set in en-US and zh-CN (plural variants tolerated)", () => {
    const enKeys = flattenKeys(en).map(collapsePlural);
    const zhKeys = flattenKeys(zh);

    expect([...new Set(zhKeys)].sort()).toEqual([...new Set(enKeys)].sort());
  });

  it("keeps every leaf a non-empty string", () => {
    const nonStrings = flattenKeys(en)
      .map((key) => [key, flattenValues(en).get(key)] as const)
      .filter(([, value]) => typeof value !== "string" || value === "");

    expect(nonStrings).toEqual([]);
  });

  it("uses the same interpolation variables in both languages", () => {
    const enValues = flattenValues(en);
    const zhValues = flattenValues(zh);

    for (const [enKey, enValue] of enValues) {
      const zhKey = collapsePlural(enKey);
      const zhValue = zhValues.get(zhKey);
      expect(zhValue, `missing zh value for ${zhKey}`).toBeTypeOf("string");
      if (typeof zhValue !== "string") continue;
      expect(
        interpolationVariables(zhValue).sort(),
        `interpolation mismatch for ${zhKey}`,
      ).toEqual(interpolationVariables(enValue).sort());
    }
  });

  it("declares each English plural as a complete _one/_other pair", () => {
    const enValues = flattenValues(en);
    for (const [key] of enValues) {
      if (key.endsWith("_one")) {
        const base = key.slice(0, -"_one".length);
        expect(enValues.has(`${base}_other`), `missing ${base}_other`).toBe(
          true,
        );
      }
      if (key.endsWith("_other")) {
        const base = key.slice(0, -"_other".length);
        expect(enValues.has(`${base}_one`), `missing ${base}_one`).toBe(true);
      }
    }
  });
});
