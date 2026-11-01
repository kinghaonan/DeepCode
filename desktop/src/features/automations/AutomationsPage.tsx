import {
  Clock3,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { TFunction } from "i18next";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  Automation,
  AutomationScheduleKind,
  Project,
  Thread,
} from "../../generated/app-server";
import { confirmAction } from "../../platform/confirmAction";
import type { DesktopRuntime } from "../../rpc/contracts";
import styles from "../management/ManagementWorkspace.module.css";
import {
  automationIntervalInput,
  automationIntervalLabel,
  automationIntervalSeconds,
  type AutomationIntervalUnit,
} from "./automationInterval";
import { useAutomations } from "./useAutomations";

interface AutomationsPageProps {
  runtime: DesktopRuntime;
  project: Project | null;
  onThreadCreated(thread: Thread): void;
  onOpenThread(threadId: string): void;
}

interface AutomationDraft {
  id: string | null;
  name: string;
  prompt: string;
  scheduleKind: AutomationScheduleKind;
  intervalValue: string;
  intervalUnit: AutomationIntervalUnit;
  enabled: boolean;
}

const emptyDraft: AutomationDraft = {
  id: null,
  name: "",
  prompt: "",
  scheduleKind: "manual",
  intervalValue: "1",
  intervalUnit: "hours",
  enabled: true,
};

export function AutomationsPage({
  runtime,
  project,
  onThreadCreated,
  onOpenThread,
}: AutomationsPageProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<AutomationDraft | null>(null);
  const [expandedRuns, setExpandedRuns] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const automations = useAutomations(
    runtime,
    project?.id ?? null,
    expandedRuns,
  );
  const canExecute = project?.trustState === "trusted";
  const latestRuns = useMemo(
    () =>
      new Map(
        (automations.inventory?.latestRuns ?? []).map((run) => [
          run.automationId,
          run,
        ]),
      ),
    [automations.inventory?.latestRuns],
  );

  const edit = (automation: Automation) => {
    setFormError(null);
    const interval = automationIntervalInput(automation.intervalSeconds);
    setDraft({
      id: automation.id,
      name: automation.name,
      prompt: automation.prompt,
      scheduleKind: automation.scheduleKind,
      intervalValue: interval.value,
      intervalUnit: interval.unit,
      enabled: automation.status === "enabled",
    });
  };

  const save = async () => {
    if (!draft || !project) return;
    setFormError(null);
    let intervalSeconds: number | undefined;
    if (draft.scheduleKind === "interval") {
      const interval = automationIntervalSeconds({
        value: draft.intervalValue,
        unit: draft.intervalUnit,
      });
      if (interval.error !== null) {
        setFormError(interval.error);
        return;
      }
      intervalSeconds = interval.intervalSeconds;
    }
    if (draft.id) {
      const updated = await automations.update({
        automationId: draft.id,
        name: draft.name.trim(),
        prompt: draft.prompt.trim(),
        scheduleKind: draft.scheduleKind,
        ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
        status:
          draft.scheduleKind === "interval" && !draft.enabled
            ? "paused"
            : "enabled",
      });
      if (updated) setDraft(null);
      return;
    }
    const created = await automations.create({
      name: draft.name.trim(),
      prompt: draft.prompt.trim(),
      scheduleKind: draft.scheduleKind,
      ...(intervalSeconds !== undefined ? { intervalSeconds } : {}),
      enabled: draft.scheduleKind !== "interval" || draft.enabled,
    });
    if (created) {
      onThreadCreated(created.thread);
      setDraft(null);
    }
  };

  const toggleRuns = async (automationId: string) => {
    if (expandedRuns === automationId) {
      setExpandedRuns(null);
      return;
    }
    setExpandedRuns(automationId);
    await automations.loadRuns(automationId);
  };

  const remove = async (automation: Automation) => {
    if (
      !(await confirmAction(
        t("automation.removeConfirm", { name: automation.name }),
        {
          confirmLabel: t("automation.removeConfirmLabel"),
        },
      ))
    ) {
      return;
    }
    if (await automations.remove(automation.id)) {
      if (draft?.id === automation.id) setDraft(null);
      if (expandedRuns === automation.id) setExpandedRuns(null);
    }
  };

  return (
    <section className={styles.page} aria-labelledby="automations-title">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{t("automation.eyebrow")}</p>
          <h1 id="automations-title">{t("automation.title")}</h1>
          <p>{t("automation.description")}</p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!project || automations.loading}
            onClick={() => void automations.refresh()}
          >
            <RefreshCw size={14} />
            {t("automation.refresh")}
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!project || !canExecute}
            onClick={() => {
              setFormError(null);
              setDraft({ ...emptyDraft });
            }}
          >
            <Plus size={14} />
            {t("automation.new")}
          </button>
        </div>
      </header>

      {!project ? (
        <div className={styles.emptyState}>
          <h2>{t("automation.openProjectFirst")}</h2>
          <p>{t("automation.fencedNote")}</p>
        </div>
      ) : (
        <>
          <div className={styles.contextBar}>
            <strong>{project.displayName}</strong>
            <span>
              {automations.inventory?.schedulerActive
                ? t("automation.schedulerActive")
                : t("automation.schedulerUnavailable")}
            </span>
          </div>
          {!canExecute ? (
            <p className={styles.warningBlock}>
              {t("automation.trustFirst")}
            </p>
          ) : null}
          {automations.error ? (
            <p className={styles.errorBanner}>{automations.error}</p>
          ) : null}

          <div className={styles.cardList}>
            {(automations.inventory?.automations ?? []).map((automation) => {
              const latest = latestRuns.get(automation.id);
              const runPage = automations.runs[automation.id];
              const runHistory = runPage?.runs ?? [];
              return (
                <article className={styles.card} key={automation.id}>
                  <header>
                    <div>
                      <p className={styles.eyebrow}>
                        {scheduleLabel(automation, t)}
                      </p>
                      <h2>{automation.name}</h2>
                    </div>
                    <div className={styles.headerActions}>
                      <span
                        className={styles.badge}
                        data-status={automation.status}
                      >
                        {t("automation.statusWithValue", {
                          status: automation.status,
                        })}
                      </span>
                      {latest ? (
                        <span
                          className={styles.badge}
                          data-status={latest.status}
                        >
                          {t("automation.latestRunWithValue", {
                            status: latest.status,
                          })}
                        </span>
                      ) : null}
                    </div>
                  </header>
                  <p>{automation.prompt}</p>
                  <dl className={styles.metadata}>
                    <div>
                      <dt>{t("automation.nextRun")}</dt>
                      <dd>
                        {dateLabel(
                          automation.nextRunAt,
                          t("automation.manualOnly"),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("automation.lastRun")}</dt>
                      <dd>
                        {dateLabel(
                          automation.lastRunAt,
                          t("automation.notRunYet"),
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("automation.goalThread")}</dt>
                      <dd>{automation.threadId}</dd>
                    </div>
                  </dl>
                  <footer className={styles.cardActions}>
                    <button
                      type="button"
                      disabled={automations.loading || !canExecute}
                      onClick={() => void automations.runNow(automation.id)}
                    >
                      <Play size={13} />
                      {t("automation.runNow")}
                    </button>
                    {automation.scheduleKind === "interval" ? (
                      <button
                        type="button"
                        disabled={automations.loading}
                        onClick={() =>
                          void automations.update({
                            automationId: automation.id,
                            status:
                              automation.status === "enabled"
                                ? "paused"
                                : "enabled",
                          })
                        }
                      >
                        {automation.status === "enabled" ? (
                          <Pause size={13} />
                        ) : (
                          <Play size={13} />
                        )}
                        {automation.status === "enabled"
                          ? t("automation.pause")
                          : t("automation.resume")}
                      </button>
                    ) : null}
                    <button type="button" onClick={() => edit(automation)}>
                      {t("automation.edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenThread(automation.threadId)}
                    >
                      {t("automation.openThread")}
                    </button>
                    <button
                      type="button"
                      disabled={automations.loadingRunsFor === automation.id}
                      onClick={() => void toggleRuns(automation.id)}
                    >
                      <History size={13} />
                      {t("automation.runs")}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(latest && !isTerminal(latest.status))}
                      onClick={() => void remove(automation)}
                    >
                      <Trash2 size={13} />
                      {t("automation.remove")}
                    </button>
                  </footer>
                  {expandedRuns === automation.id ? (
                    <div className={styles.runList}>
                      {runHistory.length ? (
                        runHistory.map((run) => (
                          <div key={run.id} data-status={run.status}>
                            <Clock3 size={12} />
                            <span>
                              <strong>{run.status}</strong>
                              <small>
                                {dateLabel(
                                  run.scheduledFor,
                                  t("automation.unknownTime"),
                                )}
                                {run.detail ? ` · ${run.detail}` : ""}
                              </small>
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className={styles.emptyCopy}>
                          {t("automation.noRuns")}
                        </p>
                      )}
                      {runPage?.hasMore ? (
                        <footer className={styles.cardActions}>
                          <button
                            type="button"
                            disabled={
                              automations.loadingRunsFor === automation.id
                            }
                            onClick={() =>
                              void automations.loadMoreRuns(automation.id)
                            }
                          >
                            {t("automation.loadMoreRuns")}
                          </button>
                        </footer>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!automations.loading &&
            !(automations.inventory?.automations.length ?? 0) ? (
              <p className={styles.emptyCopy}>
                {t("automation.noneExist")}
              </p>
            ) : null}
          </div>
          {automations.inventory?.hasMore ? (
            <footer className={styles.formActions}>
              <span>
                {t("automation.showingCount", {
                  count: automations.inventory.automations.length,
                })}
              </span>
              <button
                type="button"
                disabled={automations.loadingMoreAutomations}
                onClick={() => void automations.loadMoreAutomations()}
              >
                {t("automation.loadMore")}
              </button>
            </footer>
          ) : null}

          {draft ? (
            <section
              className={styles.formCard}
              aria-label={t("automation.editorAria")}
            >
              <header>
                <div>
                  <p className={styles.eyebrow}>
                    {draft.id
                      ? t("automation.editTitle")
                      : t("automation.newTitle")}
                  </p>
                  <h2>{t("automation.goalAndSchedule")}</h2>
                </div>
                <button type="button" onClick={() => setDraft(null)}>
                  {t("common.cancel")}
                </button>
              </header>
              <div className={styles.formGrid}>
                <label>
                  {t("automation.name")}
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                  />
                </label>
                <label>
                  {t("automation.schedule")}
                  <select
                    value={draft.scheduleKind}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        scheduleKind: event.target
                          .value as AutomationScheduleKind,
                      })
                    }
                  >
                    <option value="manual">{t("automation.manualOnly")}</option>
                    <option value="interval">
                      {t("automation.recurringInterval")}
                    </option>
                  </select>
                </label>
                {draft.scheduleKind === "interval" ? (
                  <>
                    <label>
                      {t("automation.repeatEvery")}
                      <input
                        inputMode="numeric"
                        value={draft.intervalValue}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            intervalValue: event.target.value,
                          })
                        }
                      />
                    </label>
                    <label>
                      {t("automation.unit")}
                      <select
                        value={draft.intervalUnit}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            intervalUnit: event.target
                              .value as AutomationIntervalUnit,
                          })
                        }
                      >
                        <option value="seconds">
                          {t("automation.unitSeconds")}
                        </option>
                        <option value="minutes">
                          {t("automation.unitMinutes")}
                        </option>
                        <option value="hours">
                          {t("automation.unitHours")}
                        </option>
                      </select>
                    </label>
                    <label className={styles.checkboxField}>
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            enabled: event.target.checked,
                          })
                        }
                      />
                      {t("automation.enableRecurring")}
                    </label>
                  </>
                ) : null}
                <label className={styles.wideField}>
                  {t("automation.goalPrompt")}
                  <textarea
                    rows={7}
                    value={draft.prompt}
                    onChange={(event) =>
                      setDraft({ ...draft, prompt: event.target.value })
                    }
                    placeholder={t("automation.goalPromptPlaceholder")}
                  />
                </label>
              </div>
              {formError ? (
                <p className={styles.errorBanner}>{formError}</p>
              ) : null}
              <footer className={styles.formActions}>
                <span>{t("automation.scheduledRunsNote")}</span>
                <button type="button" onClick={() => setDraft(null)}>
                  {t("common.cancel")}
                </button>
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={
                    automations.loading ||
                    !canExecute ||
                    !draft.name.trim() ||
                    !draft.prompt.trim()
                  }
                  onClick={() => void save()}
                >
                  {t("automation.save")}
                </button>
              </footer>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}

function scheduleLabel(automation: Automation, t: TFunction): string {
  if (automation.scheduleKind === "manual") return t("automation.manualGoal");
  return t("automation.everyInterval", {
    interval: automationIntervalLabel(automation.intervalSeconds),
  });
}

function dateLabel(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function isTerminal(status: string): boolean {
  return ["completed", "failed", "interrupted", "skipped"].includes(status);
}
