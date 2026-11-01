import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MethodParams, MethodResults } from "../generated/app-server";
import type {
  AnyRpcNotification,
  DesktopRuntime,
  RpcMethod,
  SidecarStatus,
} from "../rpc/contracts";
import { useWorkspaceController } from "./useWorkspaceController";

const crashedStatus: SidecarStatus = {
  phase: "crashed",
  message: "sidecar exited",
  launchSource: "test",
  serverInfo: null,
};

const readyStatus: SidecarStatus = {
  phase: "ready",
  message: null,
  launchSource: "test",
  serverInfo: null,
};

class ReconnectRuntime implements DesktopRuntime {
  statusListener: ((status: SidecarStatus) => void) | null = null;
  restartResults: SidecarStatus[] = [];
  restartCalls = 0;

  async status() {
    return crashedStatus;
  }

  async restart() {
    this.restartCalls += 1;
    const index = Math.min(
      this.restartCalls - 1,
      this.restartResults.length - 1,
    );
    return this.restartResults[index] ?? crashedStatus;
  }

  async onStatus(listener: (status: SidecarStatus) => void) {
    this.statusListener = listener;
    return () => {
      this.statusListener = null;
    };
  }

  async onNotification(listener: (notification: AnyRpcNotification) => void) {
    void listener;
    return () => undefined;
  }

  async onLog(listener: (message: string) => void) {
    void listener;
    return () => undefined;
  }

  async request<M extends RpcMethod>(
    method: M,
    params: MethodParams[M],
  ): Promise<MethodResults[M]> {
    void method;
    void params;
    throw new Error(`Unexpected workspace request: ${method}`);
  }

  async pickDirectory() {
    return null;
  }

  async pickFile() {
    return null;
  }

  async pickContextFiles() {
    return [];
  }

  async exportDiagnostics() {
    return null;
  }

  async checkForUpdate() {
    return null;
  }

  async installUpdate() {
    return undefined;
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useWorkspaceController automatic reconnect", () => {
  it("reconnects after a crash and recovers when restart succeeds", async () => {
    const runtime = new ReconnectRuntime();
    runtime.restartResults = [readyStatus];
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await act(async () => {});

    expect(result.current.state.runtime.phase).toBe("crashed");
    expect(result.current.state.reconnecting).toBe(true);
    expect(runtime.restartCalls).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(runtime.restartCalls).toBe(1);
    expect(result.current.state.runtime.phase).toBe("ready");
    expect(result.current.state.reconnecting).toBe(false);
  });

  it("stops retrying after all attempts fail and keeps the crashed banner", async () => {
    const runtime = new ReconnectRuntime();
    runtime.restartResults = [
      crashedStatus,
      crashedStatus,
      crashedStatus,
      crashedStatus,
    ];
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await act(async () => {});
    expect(result.current.state.reconnecting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(runtime.restartCalls).toBe(4);
    expect(result.current.state.runtime.phase).toBe("crashed");
    expect(result.current.state.reconnecting).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60000);
    });
    expect(runtime.restartCalls).toBe(4);
  });

  it("cancels a pending automatic reconnect when the user restarts manually", async () => {
    const runtime = new ReconnectRuntime();
    runtime.restartResults = [readyStatus];
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await act(async () => {});
    expect(result.current.state.reconnecting).toBe(true);

    await act(async () => {
      await result.current.restartRuntime();
    });

    expect(result.current.state.reconnecting).toBe(false);
    expect(runtime.restartCalls).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(runtime.restartCalls).toBe(1);
  });

  it("resets the attempt counter after a successful recovery", async () => {
    const runtime = new ReconnectRuntime();
    runtime.restartResults = [readyStatus, readyStatus];
    const { result } = renderHook(() => useWorkspaceController(runtime));
    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(runtime.restartCalls).toBe(1);
    expect(result.current.state.reconnecting).toBe(false);

    act(() => {
      runtime.statusListener?.(crashedStatus);
    });
    expect(result.current.state.reconnecting).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(runtime.restartCalls).toBe(2);
    expect(result.current.state.reconnecting).toBe(false);
  });
});
