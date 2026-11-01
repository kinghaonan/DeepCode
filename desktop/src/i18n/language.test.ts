import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import i18n from "./index";
import {
  getInitialLanguage,
  STORAGE_KEY,
  useLanguage,
} from "./language";

function installLocalStorage() {
  const store = new Map<string, string>();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation((key: string) => {
    return store.get(key) ?? null;
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    (key: string, value: string) => {
      store.set(key, value);
    },
  );
  return store;
}

function installNavigatorLanguage(language: string) {
  Object.defineProperty(window.navigator, "language", {
    configurable: true,
    value: language,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window.navigator, "language");
  document.documentElement.lang = "";
});

describe("getInitialLanguage", () => {
  it("returns the stored language when localStorage has a value", () => {
    const store = installLocalStorage();
    store.set(STORAGE_KEY, "en-US");
    installNavigatorLanguage("zh-CN");

    expect(getInitialLanguage()).toBe("en-US");

    store.set(STORAGE_KEY, "zh-CN");
    expect(getInitialLanguage()).toBe("zh-CN");
  });

  it("returns zh-CN for a zh browser language when nothing is stored", () => {
    installLocalStorage();
    installNavigatorLanguage("zh-CN");

    expect(getInitialLanguage()).toBe("zh-CN");
  });

  it("returns en-US for a non-zh browser language when nothing is stored", () => {
    installLocalStorage();
    installNavigatorLanguage("en-US");

    expect(getInitialLanguage()).toBe("en-US");
  });

  it("falls back to en-US when neither storage nor browser language is usable", () => {
    installLocalStorage();

    expect(getInitialLanguage()).toBe("en-US");
  });
});

describe("useLanguage", () => {
  it("persists setLanguage to localStorage and updates i18n plus <html lang>", async () => {
    const store = installLocalStorage();
    const { result } = renderHook(() => useLanguage());

    expect(result.current[0]).toBe("en-US");

    await act(async () => {
      result.current[1]("zh-CN");
    });

    expect(store.get(STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
    expect(i18n.language).toBe("zh-CN");
    expect(result.current[0]).toBe("zh-CN");

    await act(async () => {
      result.current[1]("en-US");
    });

    expect(store.get(STORAGE_KEY)).toBe("en-US");
    expect(document.documentElement.lang).toBe("en-US");
    expect(i18n.language).toBe("en-US");
    expect(result.current[0]).toBe("en-US");
  });

  it("initializes from the stored language", () => {
    const store = installLocalStorage();
    store.set(STORAGE_KEY, "zh-CN");

    const { result } = renderHook(() => useLanguage());

    expect(result.current[0]).toBe("zh-CN");
  });
});
