import { ArrowDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Approval,
  ApprovalDecision,
  Item,
  Turn,
} from "../../generated/app-server";
import type { TurnPlanState } from "../../app/workspaceState";
import type { DesktopInspectorTab } from "../../app/useDesktopUi";
import { buildConversationTurns } from "./conversationModel";
import { PlanProgress } from "./PlanProgress";
import styles from "./ThreadConversation.module.css";
import { TurnBlock } from "./TurnBlock";
import type { TranscriptMode } from "./transcriptMode";

interface ThreadConversationProps {
  turns: Turn[];
  items: Item[];
  approvals: Approval[];
  plansByTurnId: Record<string, TurnPlanState>;
  selectedItemId: string | null;
  transcriptMode: TranscriptMode;
  busy: boolean;
  onSelectItem(itemId: string): void;
  onOpenInspector(tab?: DesktopInspectorTab): void;
  onRespondToApproval(approvalId: string, decision: ApprovalDecision): void;
  onRetryTurn(turnId: string): void;
  onCancelQueuedTurn(turnId: string): void;
}

const FOLLOW_THRESHOLD = 120;

export function ThreadConversation({
  turns,
  items,
  approvals,
  plansByTurnId,
  selectedItemId,
  transcriptMode,
  busy,
  onSelectItem,
  onOpenInspector,
  onRespondToApproval,
  onRetryTurn,
  onCancelQueuedTurn,
}: ThreadConversationProps) {
  const { t } = useTranslation();
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const followingRef = useRef(true);
  const followFrameRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const groupedTurns = useMemo(
    () => buildConversationTurns(turns, items),
    [items, turns],
  );
  const approvalsByItem = useMemo(
    () => new Map(approvals.map((approval) => [approval.itemId, approval])),
    [approvals],
  );
  const activeTurn = useMemo(
    () =>
      [...turns]
        .reverse()
        .find(
          (turn) =>
            turn.status === "queued" ||
            turn.status === "running" ||
            turn.status === "waiting_approval",
        ) ?? null,
    [turns],
  );
  const activePlan = activeTurn ? plansByTurnId[activeTurn.id] ?? null : null;
  const latestItem = items.at(-1);
  const itemUpdate = latestItem
    ? `${latestItem.id}:${latestItem.status}:${latestItem.updatedAt}:${JSON.stringify(latestItem.payload).length}`
    : `${turns.at(-1)?.id ?? "empty"}:${turns.at(-1)?.status ?? "idle"}`;
  const latestUpdate = `${itemUpdate}:${activePlan?.updatedAt ?? "no-plan"}`;
  const hasConversation = groupedTurns.length > 0;

  const distanceFromBottom = useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return 0;
    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  }, []);

  const scrollToLatest = useCallback((behavior: ScrollBehavior) => {
    const viewport = scrollViewportRef.current;
    if (typeof viewport?.scrollTo === "function") {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior });
      return;
    }
    const end = endRef.current;
    if (typeof end?.scrollIntoView === "function") {
      end.scrollIntoView({ block: "end", behavior });
    }
  }, []);

  // The scroll listener only tracks the "Latest" button visibility. It never
  // leaves follow mode: programmatic/content-driven scrolls must not be
  // mistaken for the user scrolling away from the bottom.
  useEffect(() => {
    if (!hasConversation) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const handleScroll = () => {
      setShowJumpToLatest(distanceFromBottom() > FOLLOW_THRESHOLD);
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [hasConversation, distanceFromBottom]);

  // Only deliberate user input leaves follow mode: a wheel that scrolls up
  // (deltaY > 0) or a touch drag that slides up, once the viewport is
  // actually far enough from the bottom. Content growth never exits.
  useEffect(() => {
    if (!hasConversation) return;
    const viewport = scrollViewportRef.current;
    if (!viewport) return;

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY <= 0) return;
      if (distanceFromBottom() > FOLLOW_THRESHOLD) {
        followingRef.current = false;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      touchStartYRef.current = touch ? touch.clientY : null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      const startY = touchStartYRef.current;
      if (!touch || startY === null) return;
      // clientY growing means the finger slides down and the viewport scrolls
      // up, away from the bottom.
      if (touch.clientY <= startY) return;
      if (distanceFromBottom() > FOLLOW_THRESHOLD) {
        followingRef.current = false;
      }
    };

    viewport.addEventListener("wheel", handleWheel, { passive: true });
    viewport.addEventListener("touchstart", handleTouchStart, { passive: true });
    viewport.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("touchstart", handleTouchStart);
      viewport.removeEventListener("touchmove", handleTouchMove);
    };
  }, [hasConversation, distanceFromBottom]);

  // Content growth while following: coalesce to one scroll per animation
  // frame. Smooth scrolling is reserved for the explicit "Latest" button.
  useEffect(() => {
    if (!followingRef.current) return;
    if (followFrameRef.current !== null) return;
    followFrameRef.current = requestAnimationFrame(() => {
      followFrameRef.current = null;
      if (followingRef.current) scrollToLatest("auto");
    });
  }, [latestItem?.status, latestUpdate, scrollToLatest]);

  // Cancel any pending follow frame when the component unmounts.
  useEffect(() => {
    return () => {
      if (followFrameRef.current !== null) {
        cancelAnimationFrame(followFrameRef.current);
        followFrameRef.current = null;
      }
    };
  }, []);

  const jumpToLatest = () => {
    followingRef.current = true;
    setShowJumpToLatest(false);
    scrollToLatest("smooth");
  };

  if (groupedTurns.length === 0) {
    return (
      <div className={styles.conversationFrame}>
        <div className={styles.conversationScroller}>
          <div className={styles.empty}>
            <span className={styles.emptyRail} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <h2>{t("thread.startWithTask")}</h2>
            <p>{t("thread.startWithTaskDescription")}</p>
            <small>{t("thread.startWithTaskFootnote")}</small>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.conversationFrame}
      data-plan-active={Boolean(activePlan)}
    >
      <div
        className={styles.conversationScroller}
        aria-label={t("thread.ariaConversation")}
        ref={scrollViewportRef}
      >
        <div className={styles.conversation}>
          {groupedTurns.map((group) => (
            <TurnBlock
              key={group.id}
              group={group}
              approvalsByItem={approvalsByItem}
              selectedItemId={selectedItemId}
              transcriptMode={transcriptMode}
              busy={busy}
              onSelectItem={onSelectItem}
              onOpenInspector={onOpenInspector}
              onRespondToApproval={onRespondToApproval}
              onRetryTurn={onRetryTurn}
              onCancelQueuedTurn={onCancelQueuedTurn}
            />
          ))}
          <div className={styles.conversationEnd} ref={endRef} />
        </div>
      </div>

      {activePlan ? (
        <div className={styles.planProgressDock}>
          <PlanProgress plan={activePlan} />
        </div>
      ) : null}

      {showJumpToLatest ? (
        <button
          type="button"
          className={styles.jumpToLatest}
          onClick={jumpToLatest}
        >
          <ArrowDown size={14} />
          {t("thread.latest")}
        </button>
      ) : null}
    </div>
  );
}
