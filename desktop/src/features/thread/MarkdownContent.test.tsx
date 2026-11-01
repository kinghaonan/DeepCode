import { act, cleanup, render, screen } from "@testing-library/react";
import { Highlight } from "prism-react-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../i18n";
import { MarkdownContent } from "./MarkdownContent";

vi.mock("prism-react-renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("prism-react-renderer")>();
  return {
    ...actual,
    Highlight: vi.fn(actual.Highlight),
  };
});

describe("MarkdownContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders GFM, safe external links, and highlighted code blocks", () => {
    const view = render(
      <MarkdownContent>
        {[
          "## Result",
          "",
          "- [x] verified",
          "",
          "| file | status |",
          "| --- | --- |",
          "| `App.tsx` | changed |",
          "",
          "[documentation](https://example.com/docs)",
          "",
          "```ts",
          "const ready = true;",
          "```",
        ].join("\n")}
      </MarkdownContent>,
    );

    expect(screen.getByRole("heading", { name: "Result" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
    const link = screen.getByRole("link", { name: "documentation" });
    expect(link.getAttribute("href")).toBe("https://example.com/docs");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(view.container.querySelector("pre")?.textContent).toContain(
      "const ready = true;",
    );
    expect(screen.getByRole("button", { name: "Copy code" })).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
  });

  it("does not render raw HTML from an Agent response", () => {
    const view = render(
      <MarkdownContent>
        {'Safe text\n\n<script>window.location = "https://example.com"</script>'}
      </MarkdownContent>,
    );

    expect(screen.getByText("Safe text")).toBeTruthy();
    expect(view.container.querySelector("script")).toBeNull();
    expect(screen.queryByText(/window\.location/)).toBeNull();
  });

  it("throttles streaming deltas and renders the complete text after a tick", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <MarkdownContent streaming>First</MarkdownContent>,
    );

    // Initial text renders immediately.
    expect(screen.getByText("First")).toBeTruthy();

    // Rapid deltas accumulate in the ref without re-rendering per delta.
    rerender(<MarkdownContent streaming>First second</MarkdownContent>);
    rerender(<MarkdownContent streaming>First second third</MarkdownContent>);

    // Nothing flushed yet: still showing the last flushed snapshot.
    expect(screen.getByText("First")).toBeTruthy();
    expect(screen.queryByText(/third/)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(120);
    });

    expect(screen.getByText(/third/)).toBeTruthy();
  });

  it("flushes the complete text immediately when streaming ends", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <MarkdownContent streaming>Partial</MarkdownContent>,
    );

    rerender(
      <MarkdownContent streaming>Partial and more</MarkdownContent>,
    );
    // Before any tick the newer delta has not flushed.
    expect(screen.queryByText(/more/)).toBeNull();

    // Stream ends with the final text; it must appear without advancing timers.
    rerender(
      <MarkdownContent streaming={false}>
        Partial and more and done
      </MarkdownContent>,
    );
    expect(screen.getByText(/done/)).toBeTruthy();
  });

  it("flushes accumulated text on unmount mid-stream without erroring", () => {
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const { unmount } = render(
        <MarkdownContent streaming>unflushed tail</MarkdownContent>,
      );

      // Unmount before the interval ever ticks: cleanup must flush without
      // logging a "state update on unmounted component" warning (React 19
      // no longer warns, but the cleanup path still runs).
      unmount();

      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  it("does not re-highlight an unchanged code block when the parent re-renders", () => {
    const source = "```ts\nconst ready = true;\n```";
    const { rerender } = render(<MarkdownContent>{source}</MarkdownContent>);
    expect(Highlight).toHaveBeenCalledTimes(1);

    // Parent re-render with identical markdown (and a different unrelated
    // prop): memoized CodeBlock keeps Highlight from running again.
    rerender(<MarkdownContent compact>{source}</MarkdownContent>);
    expect(Highlight).toHaveBeenCalledTimes(1);
  });
});
