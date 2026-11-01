import type { Goal, Turn } from "../../generated/app-server";
import i18n from "../../i18n";

export type GoalPresentationStatus =
  | "working"
  | "readyToContinue"
  | "finishing"
  | "paused"
  | "blocked"
  | "budget_limited"
  | "complete";

export interface GoalPresentation {
  status: GoalPresentationStatus;
  label: string;
  linkedTurnCount: number;
  liveTurnId: string | null;
}

const LABEL_KEYS: Record<GoalPresentationStatus, string> = {
  working: "goal.status.working",
  readyToContinue: "goal.status.readyToContinue",
  finishing: "goal.status.finishing",
  paused: "goal.status.paused",
  blocked: "goal.status.blocked",
  budget_limited: "goal.status.budgetLimited",
  complete: "goal.status.complete",
};

/** Derive transient Goal UI state without extending the persisted ledger. */
export function deriveGoalPresentation(
  goal: Goal,
  turns: readonly Turn[],
  decidingTurnId: string | null = null,
): GoalPresentation {
  const linkedTurns = turns.filter((turn) => turn.goalId === goal.id);
  const liveTurn =
    linkedTurns
      .filter((turn) => !isTerminal(turn.status))
      .sort((left, right) => right.ordinal - left.ordinal)[0] ?? null;

  let status: GoalPresentationStatus;
  if (goal.status === "active") {
    status = liveTurn ? "working" : "readyToContinue";
  } else if (goal.status === "complete" && decidingTurnId) {
    const decidingTurn = turns.find((turn) => turn.id === decidingTurnId);
    status =
      decidingTurn && !isTerminal(decidingTurn.status)
        ? "finishing"
        : "complete";
  } else {
    status = goal.status;
  }

  return {
    status,
    label: i18n.t(LABEL_KEYS[status]),
    linkedTurnCount: linkedTurns.length,
    liveTurnId: liveTurn?.id ?? null,
  };
}

function isTerminal(status: Turn["status"]): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "interrupted"
  );
}
