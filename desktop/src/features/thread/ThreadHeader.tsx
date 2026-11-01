import {
  Files,
  FolderX,
  GitFork,
  PanelRight,
  PanelRightClose,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { isRecoveredHistoryProject } from "../../app/projectPresentation";
import type { Project, Thread } from "../../generated/app-server";
import type { SidecarStatus } from "../../rpc/contracts";
import styles from "./ThreadHeader.module.css";

interface ThreadHeaderProps {
  project: Project | null;
  thread: Thread | null;
  runtime: SidecarStatus;
  busy: boolean;
  inspectorOpen: boolean;
  hasActiveWork: boolean;
  onTrustProject(): void;
  onForkThread(): void;
  onCreatePaperThread(): void;
  onToggleInspector(): void;
}

function workspaceLabel(
  t: TFunction,
  thread: Thread | null,
  project: Project | null,
): string {
  if (isRecoveredHistoryProject(project)) return t("thread.folderUnavailable");
  const path = thread?.workspacePath ?? project?.canonicalPath;
  if (!path) return t("thread.noLocalFolder");
  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? path;
}

export function ThreadHeader({
  project,
  thread,
  runtime,
  busy,
  inspectorOpen,
  hasActiveWork,
  onTrustProject,
  onForkThread,
  onCreatePaperThread,
  onToggleInspector,
}: ThreadHeaderProps) {
  const { t } = useTranslation();
  const recoveredHistory = isRecoveredHistoryProject(project);
  const title = thread?.title ?? t("thread.startLocalThread");
  return (
    <header className={styles.header}>
      <div className={styles.identity}>
        <div className={styles.breadcrumb}>
          <span>
            {recoveredHistory
              ? t("sidebar.previousSessions")
              : (project?.displayName ?? "DeepCode")}
          </span>
          {thread ? <span aria-hidden="true">/</span> : null}
          {thread ? <span>{workspaceLabel(t, thread, project)}</span> : null}
        </div>
        <div className={styles.titleRow}>
          <span
            className={styles.beacon}
            data-status={thread?.status ?? runtime.phase}
            aria-hidden="true"
          />
          <h1 id="thread-title" title={title}>
            {title}
          </h1>
        </div>
      </div>

      <div className={styles.actions}>
        {recoveredHistory ? (
          <span
            className={styles.unavailableState}
            title={t("thread.originalFolderUnavailable")}
          >
            <FolderX size={14} />
            {t("thread.folderUnavailable")}
          </span>
        ) : project?.trustState === "untrusted" ? (
          <button
            className={styles.attentionAction}
            type="button"
            onClick={onTrustProject}
            disabled={busy}
          >
            <ShieldAlert size={15} />
            {t("thread.trustFolder")}
          </button>
        ) : project ? (
          <span className={styles.trustState} title={t("thread.executionAllowed")}>
            <ShieldCheck size={14} />
            {t("thread.trusted")}
          </span>
        ) : null}

        {thread && project?.trustState === "trusted" && !recoveredHistory ? (
          <>
            {thread.mode !== "paper" ? (
              <button
                type="button"
                onClick={onCreatePaperThread}
                disabled={busy || hasActiveWork}
                title={t("thread.createPaperThread")}
              >
                <ScrollText size={15} />
                {t("thread.paper")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onForkThread}
              disabled={busy || hasActiveWork}
              title={t("thread.forkIntoWorktree")}
            >
              <GitFork size={15} />
              {t("thread.fork")}
            </button>
          </>
        ) : null}

        {thread ? (
          <button
            className={styles.reviewAction}
            type="button"
            data-active={inspectorOpen}
            onClick={onToggleInspector}
            aria-pressed={inspectorOpen}
            title={inspectorOpen ? t("thread.closeReviewPanel") : t("thread.openReviewPanel")}
          >
            <Files size={15} />
            {t("thread.review")}
            {inspectorOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
          </button>
        ) : null}
      </div>
    </header>
  );
}
