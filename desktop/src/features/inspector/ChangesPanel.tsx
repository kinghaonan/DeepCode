import type { Thread } from "../../generated/app-server";
import { useTranslation } from "react-i18next";
import { confirmAction } from "../../platform/confirmAction";
import type { CodeWorkbenchController } from "../workbench/useCodeWorkbench";
import { InspectorEmpty } from "./InspectorEmpty";
import styles from "./Inspector.module.css";

interface ChangesPanelProps {
  thread: Thread | null;
  trusted: boolean;
  hasActiveTurn: boolean;
  workbench: CodeWorkbenchController;
  onOpenFile(path: string): void;
}

export function ChangesPanel({
  thread,
  trusted,
  hasActiveTurn,
  workbench,
  onOpenFile,
}: ChangesPanelProps) {
  const { t } = useTranslation();
  const cleanWorktree = async () => {
    const dirty = Boolean(workbench.git?.entries.length);
    if (
      dirty &&
      !(await confirmAction(
        t("inspector.removeWorktreeConfirm"),
        {
          confirmLabel: t("inspector.removeWorktree"),
        },
      ))
    ) {
      return;
    }
    await workbench.resolveWorktree("clean", dirty);
  };

  const discardFile = async (path: string, revision: string) => {
    const file = workbench.diffs.find(
      (candidate) => candidate.path === path && candidate.revision === revision,
    );
    if (
      !file ||
      !(await confirmAction(
        t("inspector.discardChangesConfirm", { path }),
        {
          confirmLabel: t("inspector.discardChanges"),
        },
      ))
    ) {
      return;
    }
    await workbench.discardChange(file);
  };

  return (
    <div className={styles.content}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>{t("inspector.gitWorkspace")}</p>
          <h2>{workbench.git?.branch ?? t("inspector.noGitBranch")}</h2>
        </div>
        <button type="button" onClick={() => void workbench.refresh()}>
          {t("inspector.refresh")}
        </button>
      </div>

      {thread?.worktreePath ? (
        <div className={styles.worktreeControl}>
          <strong>{t("inspector.isolatedWorktree")}</strong>
          <span>{thread.worktreePath}</span>
          <div>
            <button
              type="button"
              disabled={!trusted || hasActiveTurn || workbench.loading}
              onClick={() => void workbench.resolveWorktree("keep")}
            >
              {t("inspector.keepWorktree")}
            </button>
            <button
              type="button"
              disabled={!trusted || hasActiveTurn || workbench.loading}
              onClick={() => void cleanWorktree()}
            >
              {t("inspector.cleanWorktree")}
            </button>
          </div>
        </div>
      ) : (
        <button
          className={styles.outlinedAction}
          type="button"
          onClick={() => void workbench.createWorktree()}
          disabled={
            !trusted || hasActiveTurn || !workbench.git || workbench.loading
          }
        >
          {t("inspector.isolateWorktree")}
        </button>
      )}

      {workbench.gitError ? (
        <InspectorEmpty label={workbench.gitError} compact />
      ) : workbench.diffs.length ? (
        <div className={styles.diffList}>
          {workbench.diffs.map((file) => (
            <section key={file.path} className={styles.fileDiff}>
              <header>
                <strong>{file.path}</strong>
                <span>
                  <b>+{file.additions}</b> <i>−{file.deletions}</i>
                </span>
              </header>
              <div className={styles.diffActions}>
                <button
                  type="button"
                  disabled={file.binary || file.status === "deleted"}
                  onClick={() => onOpenFile(file.path)}
                >
                  {t("inspector.openInEditor")}
                </button>
                <button
                  type="button"
                  disabled={!trusted || hasActiveTurn || workbench.loading}
                  onClick={() => void discardFile(file.path, file.revision)}
                >
                  {t("inspector.discardFile")}
                </button>
              </div>
              {file.binary ? (
                <p className={styles.binaryNotice}>{t("inspector.binaryFileChanged")}</p>
              ) : (
                file.hunks.map((hunk, hunkIndex) => (
                  <div className={styles.diffHunk} key={`${file.path}-${hunkIndex}`}>
                    <div className={styles.hunkHeader}>
                      −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
                    </div>
                    {hunk.lines.map((line, lineIndex) => (
                      <div
                        className={styles.diffLine}
                        data-kind={line.kind}
                        key={`${line.kind}-${lineIndex}`}
                      >
                        <span>{line.oldLine ?? ""}</span>
                        <span>{line.newLine ?? ""}</span>
                        <code>
                          {line.kind === "addition"
                            ? "+"
                            : line.kind === "deletion"
                              ? "−"
                              : " "}
                          {line.text}
                        </code>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </section>
          ))}
        </div>
      ) : (
        <InspectorEmpty label={t("inspector.workingTreeClean")} compact />
      )}
      {hasActiveTurn ? (
        <p className={styles.note}>
          {t("inspector.changesLockedNote")}
        </p>
      ) : null}
    </div>
  );
}
