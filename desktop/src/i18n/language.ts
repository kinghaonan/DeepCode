import { useCallback, useState } from "react";

import i18n from "./index";

export const STORAGE_KEY = "deepcode.desktop.language";

export type Language = "zh-CN" | "en-US";

const SUPPORTED_LANGUAGES: readonly Language[] = ["zh-CN", "en-US"];

function isLanguage(value: string | null): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value);
}

function browserLanguage(): string | null {
  try {
    return navigator.language ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve the initial UI language.
 *
 * A persisted choice wins. Otherwise the browser language selects the closest
 * supported locale: any `zh*` language resolves to simplified Chinese, and
 * everything else falls back to English (US).
 */
export function getInitialLanguage(): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch {
    // Private storage modes may reject reads; fall through to the browser.
  }
  const browser = browserLanguage();
  if (browser && browser.toLowerCase().startsWith("zh")) return "zh-CN";
  return "en-US";
}

/**
 * UI language state for the language switcher.
 *
 * `setLanguage` persists the choice, switches the active i18next language, and
 * keeps `<html lang>` in sync for accessibility and browser translation hints.
 */
export function useLanguage(): [Language, (language: Language) => void] {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private storage modes may reject writes; the in-memory choice remains.
    }
    document.documentElement.lang = next;
    void i18n.changeLanguage(next);
  }, []);

  return [language, setLanguage];
}
