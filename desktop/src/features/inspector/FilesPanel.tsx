import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { useSystemDarkMode } from "../../app/useSystemDarkMode";
import { confirmAction } from "../../platform/confirmAction";
import type { CodeWorkbenchController } from "../workbench/useCodeWorkbench";
import { InspectorEmpty } from "./InspectorEmpty";
import { languageFor } from "./inspectorFormat";
import styles from "./Inspector.module.css";

const LocalMonacoEditor = lazy(() => import("../workbench/LocalMonacoEditor"));

interface FilesPanelProps {
  trusted: boolean;
  hasActiveTurn: boolean;
  workbench: CodeWorkbenchController;
}

export function FilesPanel({
  trusted,
  hasActiveTurn,
  workbench,
}: FilesPanelProps) {
  const { t } = useTranslation();
  const darkMode = useSystemDarkMode();
  const dirty = Boolean(
    workbench.file && workbench.draft !== workbench.file.content,
  );

  const openFile = async (path: string) => {
    if (
      dirty &&
      !(await confirmAction(
        t("inspector.discardDraftOpenFile"),
        {
          confirmLabel: t("inspector.discardDraftConfirm"),
        },
      ))
    ) {
      return;
    }
    await workbench.openFile(path);
  };

  return (
    <div className={styles.filesView}>
      <div className={styles.fileTree} aria-label={t("inspector.workspaceFiles")}>
        {workbench.entries.map((entry) => (
          <button
            key={entry.path}
            type="button"
            disabled={entry.kind !== "file"}
            onClick={() => void openFile(entry.path)}
            style={{ paddingLeft: `${10 + (entry.path.split("/").length - 1) * 10}px` }}
          >
            <span aria-hidden="true">{entry.kind === "directory" ? "▾" : "·"}</span>
            {entry.name}
          </button>
        ))}
        {workbench.entriesTruncated ? (
          <p className={styles.treeNotice}>
            {t("inspector.fileListLimited")}
          </p>
        ) : null}
      </div>
      {workbench.file ? (
        <div className={styles.fileEditor}>
          <header>
            <span title={workbench.file.path}>{workbench.file.path}</span>
            <div>
              {workbench.file.truncated ? (
                <small>{t("inspector.truncatedReadOnly")}</small>
              ) : dirty ? (
                <small>{t("inspector.unsaved")}</small>
              ) : null}
              <button
                type="button"
                onClick={() => void workbench.saveFile()}
                disabled={
                  !trusted ||
                  hasActiveTurn ||
                  workbench.file.truncated ||
                  !dirty ||
                  workbench.loading
                }
              >
                {t("inspector.save")}
              </button>
            </div>
          </header>
          <Suspense fallback={<div className={styles.editorLoading}>{t("inspector.loadingEditor")}</div>}>
            <LocalMonacoEditor
              height="100%"
              language={languageFor(workbench.file.path)}
              value={workbench.draft}
              onChange={(value) => workbench.setDraft(value ?? "")}
              theme={darkMode ? "vs-dark" : "vs-light"}
              options={{
                minimap: { enabled: false },
                readOnly:
                  !trusted || hasActiveTurn || workbench.file.truncated,
                fontSize: 12,
                lineHeight: 20,
                renderLineHighlight: "line",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
              }}
            />
          </Suspense>
          {hasActiveTurn ? (
            <p className={styles.editorNotice}>
              {t("inspector.editingLocked")}
            </p>
          ) : null}
        </div>
      ) : (
        <InspectorEmpty label={t("inspector.selectTextFile")} />
      )}
    </div>
  );
}
