import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import type { Item, Turn } from "../../generated/app-server";
import { ThreadConversation } from "./ThreadConversation";

const turn: Turn = {
  id: "turn-1",
  threadId: "thread-1",
  ordinal: 1,
  prompt: "Inspect and repair",
  status: "running",
  stopReason: null,
  errorCode: null,
  errorMessage: null,
  startedAt: "2026-08-13T00:00:00Z",
  completedAt: null,
};

function item(
  id: string,
  ordinal: number,
  summary: string,
  payload: Item["payload"],
): Item {
  return {
    id,
    threadId: turn.threadId,
    turnId: turn.id,
    ordinal,
    kind: "assistant_message",
    status: "in_progress",
    summary,
    payload,
    createdAt: "2026-08-13T00:00:00Z",
    updatedAt: "2026-08-13T00:00:00Z",
  };
}

const firstItem = item("item-1", 1, "Working", { text: "Working" });
const secondItem = item("item-2", 2, "Still working", {
  text: "Still working on the repair",
});

// The follow scroll uses `HTMLElement.prototype.scrollTo`, which jsdom does
// not implement. Spy on it so we can assert follow/restore scrolls.
const scrollTo = vi.fn();

// rAF is mocked to queue callbacks (matching a real browser's async frame
// scheduling) so the per-frame coalescing guard behaves correctly in tests.
let rafCallbacks: Array<FrameRequestCallback | undefined> = [];

function flushRaf() {
  const pending = rafCallbacks.filter(
    (cb): cb is FrameRequestCallback => cb !== undefined,
  );
  rafCallbacks = [];
  act(() => {
    for (const callback of pending) callback(0);
  });
}

function autoScrollCalls(): number {
  return scrollTo.mock.calls.filter(
    (call) => call[0]?.behavior === "auto",
  ).length;
}

function renderConversation(items: Item[]) {
  const props = {
    turns: [turn],
    approvals: [],
    plansByTurnId: {},
    selectedItemId: null,
    transcriptMode: "normal" as const,
    busy: false,
    onSelectItem: vi.fn(),
    onOpenInspector: vi.fn(),
    onRespondToApproval: vi.fn(),
    onRetryTurn: vi.fn(),
    onCancelQueuedTurn: vi.fn(),
  };
  const utils = render(<ThreadConversation {...props} items={items} />);
  return {
    ...utils,
    rerenderItems(next: Item[]) {
      utils.rerender(<ThreadConversation {...props} items={next} />);
    },
  };
}

// jsdom reports a 0-height layout, so `scrollHeight`/`clientHeight` are
// mocked on the scroller to make the "distance from bottom > threshold"
// branch reachable.
function giveScrollerARealHeight(scroller: Element) {
  Object.defineProperty(scroller, "scrollHeight", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(scroller, "clientHeight", {
    configurable: true,
    value: 500,
  });
}

function wheel(scroller: Element, deltaY: number) {
  act(() => {
    scroller.dispatchEvent(
      new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true }),
    );
  });
}

function touchDrag(scroller: Element, startY: number, endY: number) {
  const make = (type: string, clientY: number) => {
    const event = new CustomEvent(type, { bubbles: true });
    Object.defineProperty(event, "touches", {
      configurable: true,
      value: [{ clientY }],
    });
    return event;
  };
  act(() => {
    scroller.dispatchEvent(make("touchstart", startY));
    scroller.dispatchEvent(make("touchmove", endY));
  });
}

describe("ThreadConversation scroll follow", () => {
  beforeEach(async () => {
    scrollTo.mockClear();
    rafCallbacks = [];
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: scrollTo,
    });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      rafCallbacks[id - 1] = undefined;
    });
    await i18n.changeLanguage("en-US");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("keeps following and auto-scrolls to the bottom when content grows", () => {
    const { rerenderItems } = renderConversation([firstItem]);
    flushRaf();

    // The initial mount already follows: one auto scroll to the bottom.
    const afterMount = autoScrollCalls();
    expect(afterMount).toBeGreaterThanOrEqual(1);

    rerenderItems([firstItem, secondItem]);
    flushRaf();

    expect(autoScrollCalls()).toBeGreaterThan(afterMount);
    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "auto" }),
    );
  });

  it("stops following after the user wheels up beyond the threshold", () => {
    const { rerenderItems } = renderConversation([firstItem]);
    flushRaf();
    const scroller = screen.getByLabelText("Thread conversation");
    giveScrollerARealHeight(scroller);

    const before = autoScrollCalls();

    // deltaY > 0 means scrolling up, away from the bottom.
    wheel(scroller, 120);
    rerenderItems([firstItem, secondItem]);
    flushRaf();

    // Content grew, but the user had left the bottom: no follow scroll.
    expect(autoScrollCalls()).toBe(before);
  });

  it("does not leave follow mode when the user scrolls down", () => {
    const { rerenderItems } = renderConversation([firstItem]);
    flushRaf();
    const scroller = screen.getByLabelText("Thread conversation");
    giveScrollerARealHeight(scroller);

    const before = autoScrollCalls();

    // deltaY < 0 means scrolling down toward the bottom: stay following.
    wheel(scroller, -50);
    rerenderItems([firstItem, secondItem]);
    flushRaf();

    expect(autoScrollCalls()).toBeGreaterThan(before);
  });

  it("stops following after an upward touch drag beyond the threshold", () => {
    const { rerenderItems } = renderConversation([firstItem]);
    flushRaf();
    const scroller = screen.getByLabelText("Thread conversation");
    giveScrollerARealHeight(scroller);

    const before = autoScrollCalls();

    // clientY grows (200 -> 280): finger slides down, content scrolls up.
    touchDrag(scroller, 200, 280);
    rerenderItems([firstItem, secondItem]);
    flushRaf();

    expect(autoScrollCalls()).toBe(before);
  });

  it("restores following via the Latest button with a smooth scroll", async () => {
    const { rerenderItems } = renderConversation([firstItem]);
    flushRaf();
    const scroller = screen.getByLabelText("Thread conversation");
    giveScrollerARealHeight(scroller);

    // Leave follow mode, then a real scroll reveals the "Latest" button.
    wheel(scroller, 120);
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });

    const button = await screen.findByRole("button", { name: "Latest" });
    expect(button).toBeTruthy();

    const before = autoScrollCalls();
    fireEvent.click(button);

    expect(scrollTo).toHaveBeenLastCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
    expect(screen.queryByRole("button", { name: "Latest" })).toBeNull();

    // Following is restored: the next content growth scrolls again.
    rerenderItems([firstItem, secondItem]);
    flushRaf();
    expect(autoScrollCalls()).toBeGreaterThan(before);
  });
});
