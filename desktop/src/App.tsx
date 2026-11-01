import { FolderOpen, MessageSquarePlus } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";

import { projectCanExecute } from "./app/projectPresentation";
import { latestExecutingTurn } from "./app/interactiveTurnRouter";
import { useDesktopUi } from "./app/useDesktopUi";
import { useComposerCommands } from "./app/useComposerCommands";
import { useWorkspaceController } from "./app/useWorkspaceController";
import { RuntimeNotice } from "./components/RuntimeNotice";
import {
  Composer,
  type ComposerLaunchIntent,
} from "./features/execution/Composer";
import { DesktopSidebar } from "./features/navigation/DesktopSidebar";
import { ThreadHeader } from "./features/thread/ThreadHeader";
import { useTranscriptMode } from "./features/thread/transcriptMode";
import type { DesktopRuntime } from "./rpc/contracts";
import { tauriRuntime } from "./rpc/tauriRuntime";
import styles from "./App.module.css";

const Inspector = lazy(() =>
  import("./features/inspector/Inspector").then((module) => ({
    default: module.Inspector,
  })),
);
const ManagementWorkspace = lazy(() =>
  import("./features/management/ManagementWorkspace").then((module) => ({
    default: module.ManagementWorkspace,
  })),
);
const ThreadConversation = lazy(() =>
  import("./features/thread/ThreadConversation").then((module) => ({
    default: module.ThreadConversation,
  })),
);
const WorkflowComposer = lazy(() =>
  import("./features/workflows/WorkflowComposer").then((module) => ({
    default: module.WorkflowComposer,
  })),
);

function LoadingSurface({
  children,
  compact = false,
}: {
  children: string;
  compact?: boolean;
}) {
  return (
    <div
      className={styles.loadingSurface}
      data-compact={compact || undefined}
      role="status"
    >
      {children}
    </div>
  );
}

export function App({ runtime = tauriRuntime }: { runtime?: DesktopRuntime }) {
  const { t } = useTranslation();
  const controller = useWorkspaceController(runtime);
  const ui = useDesktopUi();
  const transcript = useTranscriptMode();
  const runComposerCommand = useComposerCommands(controller, ui);
  const [composerIntent, setComposerIntent] =
    useState<ComposerLaunchIntent | null>(null);
  const { state, selectedProject, selectedThread } = controller;
  const activeTurn = latestExecutingTurn(state.turns, selectedThread?.id);
  const queuedTurns = state.turns
    .filter(
      (turn) =>
        turn.threadId === selectedThread?.id && turn.status === "queued",
    )
    .sort((left, right) => left.ordinal - right.ordinal);
  const hasPendingTurn = state.turns.some(
    (turn) =>
      turn.threadId === selectedThread?.id &&
      ["queued", "running", "waiting_approval"].includes(turn.status),
  );
  const latestWorkflow =
    [...state.workflows].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    )[0] ?? null;
  const activeWorkflow = latestWorkflow
    ? ["queued", "running", "waiting"].includes(latestWorkflow.status)
    : false;
  const workspaceAvailable = projectCanExecute(selectedProject);
  const composerEditable =
    state.runtime.phase === "ready" &&
    workspaceAvailable &&
    selectedThread !== null;
  const agentExecutionEnabled =
    composerEditable && selectedProject?.trustState === "trusted";
  const disabledReason =
    state.runtime.phase !== "ready"
      ? t("runtime.waitingAppServer")
      : !selectedProject
        ? t("common.openProjectToBegin")
        : !workspaceAvailable
          ? t("common.folderUnavailableReadable")
        : selectedProject.trustState !== "trusted"
          ? t("thread.trustBeforeExecution")
          : !selectedThread
            ? t("common.createThreadToBegin")
            : null;
  const showingThreads = ui.destination === "threads";
  const inspectorVisible = Boolean(
    showingThreads && selectedThread && ui.inspectorOpen,
  );

  return (
    <main className={styles.shell} data-inspector={inspectorVisible}>
      <DesktopSidebar
        projects={state.projects}
        threads={state.threads}
        selectedProjectId={state.selectedProjectId}
        selectedThreadId={state.selectedThreadId}
        query={ui.sessionQuery}
        busy={state.busy}
        runtime={state.runtime}
        destination={ui.destination}
        onDestination={(destination) => {
          void ui.navigateTo(destination);
        }}
        onQueryChange={ui.setSessionQuery}
        onOpenProject={() => {
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.openProject();
            }
          })();
        }}
        onSelectProject={(projectId) => {
          if (projectId === state.selectedProjectId) return;
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.selectProject(projectId);
            }
          })();
        }}
        onCreateThread={() => {
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.createThread();
            }
          })();
        }}
        onSelectThread={(threadId) => {
          if (threadId === state.selectedThreadId) return;
          void (async () => {
            if (await ui.confirmDiscardInspectorDraft()) {
              await controller.selectThread(threadId);
            }
          })();
        }}
        onRenameThread={controller.renameThread}
        onArchiveThread={async (threadId) => {
          if (
            threadId === state.selectedThreadId &&
            !(await ui.confirmDiscardInspectorDraft())
          ) {
            return;
          }
          await controller.archiveThread(threadId);
        }}
        onDeleteThread={async (threadId) => {
          if (
            threadId === state.selectedThreadId &&
            !(await ui.confirmDiscardInspectorDraft())
          ) {
            return;
          }
          await controller.deleteThread(threadId);
        }}
      />

      <section className={styles.workspace} aria-labelledby="thread-title">
        <RuntimeNotice
          runtime={state.runtime}
          error={state.error}
          busy={state.busy}
          reconnecting={state.reconnecting}
          onRestart={() => void controller.restartRuntime()}
          onDismissError={controller.dismissError}
        />
        {showingThreads ? (
          <>
            <ThreadHeader
              project={selectedProject}
              thread={selectedThread}
              runtime={state.runtime}
              busy={state.busy}
              inspectorOpen={inspectorVisible}
              hasActiveWork={hasPendingTurn || activeWorkflow}
              onTrustProject={() => void controller.trustProject()}
              onForkThread={() => {
                void (async () => {
                  if (await ui.confirmDiscardInspectorDraft()) {
                    await controller.forkThread();
                  }
                })();
              }}
              onCreatePaperThread={() => {
                void (async () => {
                  if (await ui.confirmDiscardInspectorDraft()) {
                    await controller.createThread("paper");
                  }
                })();
              }}
              onToggleInspector={() => void ui.toggleInspector()}
            />

            <section className={styles.threadViewport}>
              {!selectedProject ? (
                <div className={styles.startState}>
                  <p className={styles.startEyebrow}>
                    {t("common.localCodingAgent")}
                  </p>
                  <h2>{t("common.openFolderToBegin")}</h2>
                  <p>{t("common.continueSessionsDescription")}</p>
                  <div className={styles.startActions}>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (await ui.confirmDiscardInspectorDraft()) {
                            await controller.openProject();
                          }
                        })();
                      }}
                    >
                      <FolderOpen size={16} />
                      {t("common.openProjectFolder")}
                    </button>
                    <span>{t("common.localRuntimeSharedHistory")}</span>
                  </div>
                </div>
              ) : !selectedThread ? (
                <div className={styles.startState}>
                  <p className={styles.startEyebrow}>
                    {selectedProject.displayName}
                  </p>
                  <h2>{t("sidebar.noSessionsHere")}</h2>
                  <p>{t("sidebar.startOutcomeDescription")}</p>
                  <div className={styles.startActions}>
                    <button
                      type="button"
                      onClick={() => {
                        void (async () => {
                          if (await ui.confirmDiscardInspectorDraft()) {
                            await controller.createThread();
                          }
                        })();
                      }}
                    >
                      <MessageSquarePlus size={16} />
                      {t("sidebar.newThread")}
                    </button>
                    <span>{t("common.cmdNFromAnywhere")}</span>
                  </div>
                </div>
              ) : (
                <Suspense
                  fallback={
                    <LoadingSurface>{t("common.loadingSession")}</LoadingSurface>
                  }
                >
                  <ThreadConversation
                    key={selectedThread.id}
                    turns={state.turns}
                    items={state.items}
                    approvals={state.approvals}
                    plansByTurnId={state.plansByTurnId}
                    selectedItemId={state.selectedItemId}
                    transcriptMode={transcript.mode}
                    busy={state.busy}
                    onSelectItem={controller.selectItem}
                    onOpenInspector={ui.openInspector}
                    onRespondToApproval={(approvalId, decision) =>
                      void controller.respondToApproval(approvalId, decision)
                    }
                    onRetryTurn={(turnId) => void controller.retryTurn(turnId)}
                    onCancelQueuedTurn={(turnId) =>
                      void controller.interruptTurn(turnId)
                    }
                  />
                </Suspense>
              )}
            </section>

            {selectedThread?.mode === "paper" ? (
              <Suspense
                fallback={
                  <LoadingSurface compact>
                    {t("workflow.loadingControls")}
                  </LoadingSurface>
                }
              >
                <WorkflowComposer
                  enabled={agentExecutionEnabled}
                  busy={state.busy}
                  workflow={latestWorkflow}
                  disabledReason={disabledReason}
                  onPickFile={controller.pickWorkflowFile}
                  onStart={controller.startWorkflow}
                  onRetry={controller.retryWorkflow}
                  onRespond={controller.respondToWorkflow}
                  onInterrupt={() => void controller.interrupt()}
                />
              </Suspense>
            ) : selectedThread ? (
              <Composer
                key={selectedThread.id}
                editable={composerEditable}
                canExecute={agentExecutionEnabled}
                busy={state.busy}
                executingTurn={activeTurn}
                queuedTurns={queuedTurns}
                runtime={runtime}
                project={selectedProject}
                thread={selectedThread}
                settings={state.settings}
                goal={state.goal}
                goalOutcome={state.goalOutcome}
                goalTurns={
                  state.goal
                    ? state.turns.filter(
                        (turn) => turn.goalId === state.goal?.id,
                      )
                    : []
                }
                disabledReason={disabledReason}
                transcriptMode={transcript.mode}
                onTranscriptModeChange={transcript.selectMode}
                onModelChange={(connectionId, model, reasoningEffort) =>
                  void controller.setThreadExecution(
                    connectionId,
                    model,
                    reasoningEffort,
                  )
                }
                onAccessPresetChange={controller.setAccessPreset}
                onSetGoal={controller.setGoal}
                onPauseGoal={controller.pauseGoal}
                onResumeGoal={controller.resumeGoal}
                onContinueGoal={controller.continueGoal}
                onClearGoal={controller.clearGoal}
                onSelectGoalEvidence={(itemId) => {
                  controller.selectItem(itemId);
                  ui.openInspector("details");
                }}
                onPickContextFiles={controller.pickContextFiles}
                onCommand={runComposerCommand}
                onSend={controller.sendTurn}
                onQueue={controller.queueTurn}
                onInterrupt={() => void controller.interrupt()}
                launchIntent={composerIntent}
                onLaunchIntentConsumed={() => setComposerIntent(null)}
              />
            ) : null}
          </>
        ) : (
          <Suspense
            fallback={
              <LoadingSurface>{t("common.loadingWorkspace")}</LoadingSurface>
            }
          >
            <ManagementWorkspace
              destination={ui.destination}
              runtime={runtime}
              project={selectedProject}
              settings={state.settings}
              busy={state.busy}
              onRefreshSettings={controller.refreshSettings}
              onUpdateSettings={controller.updateSettings}
              onThreadCreated={controller.registerThread}
              onOpenThread={(threadId) => {
                void (async () => {
                  if (await ui.navigateTo("threads")) {
                    await controller.selectThread(threadId);
                  }
                })();
              }}
              onCreateSkill={async (skill) => {
                if (!(await ui.navigateTo("threads"))) return;
                const created = await controller.createThread(
                  "code",
                  t("skills.createSkillThreadTitle"),
                );
                if (!created) return;
                setComposerIntent({
                  threadId: created.id,
                  prompt:
                    skill.defaultPrompt ??
                    t("skills.skillCreatorDefaultPrompt"),
                  skillIds: [skill.id],
                });
              }}
            />
          </Suspense>
        )}
      </section>

      {inspectorVisible ? (
        <section className={styles.reviewPane} aria-label={t("inspector.reviewPanel")}>
          <Suspense
            fallback={
              <LoadingSurface>{t("inspector.loadingReview")}</LoadingSurface>
            }
          >
            <Inspector
              runtime={runtime}
              thread={selectedThread}
              trusted={selectedProject?.trustState === "trusted"}
              turns={state.turns}
              items={state.items}
              workflows={state.workflows}
              artifacts={state.artifacts}
              selectedItemId={state.selectedItemId}
              tab={ui.inspectorTab}
              onSelectItem={controller.selectItem}
              onTabChange={ui.setInspectorTab}
              onDirtyChange={ui.setInspectorDirty}
              onClose={() => void ui.closeInspector()}
            />
          </Suspense>
        </section>
      ) : null}
    </main>
  );
}
