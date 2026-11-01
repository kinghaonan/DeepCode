import { FolderInput, Power, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  ConfigScope,
  Project,
  SkillInfo,
} from "../../generated/app-server";
import type { DesktopRuntime } from "../../rpc/contracts";
import styles from "../management/ManagementWorkspace.module.css";
import { MarkdownContent } from "../thread/MarkdownContent";
import { useSkillManagement } from "./useSkillManagement";

interface SkillsPageProps {
  runtime: DesktopRuntime;
  project: Project | null;
  onCreateSkill(skill: SkillInfo): Promise<void>;
}

export function SkillsPage({ runtime, project, onCreateSkill }: SkillsPageProps) {
  const { t } = useTranslation();
  const catalog = useSkillManagement(runtime, project?.id ?? null);
  const [scope, setScope] = useState<ConfigScope>("project");
  const [creating, setCreating] = useState(false);
  const creator = catalog.skills.find(
    (skill) => skill.name === "skill-creator" && skill.selectable && skill.enabled,
  );

  const createSkill = async () => {
    if (!creator || creating) return;
    setCreating(true);
    try {
      await onCreateSkill(creator);
    } finally {
      setCreating(false);
    }
  };

  const importSkill = async () => {
    const path = await runtime.pickDirectory();
    if (path) await catalog.importSkill(path, scope);
  };

  return (
    <section className={styles.page} aria-labelledby="skills-title">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{t("skills.eyebrow")}</p>
          <h1 id="skills-title">{t("skills.title")}</h1>
          <p>{t("skills.description")}</p>
        </div>
        <div className={styles.formActions}>
          <label className={styles.compactSelect}>
            <span>{t("skills.storeChangesIn")}</span>
            <select
              aria-label={t("skills.configScopeAria")}
              title={t("skills.scopeTitle")}
              value={scope}
              onChange={(event) => setScope(event.target.value as ConfigScope)}
            >
              <option value="project">{t("skills.thisProject")}</option>
              <option value="user">{t("skills.userSettings")}</option>
            </select>
          </label>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!project || catalog.loading}
            onClick={() => void catalog.refresh()}
          >
            <RefreshCw size={14} />
            {t("skills.reload")}
          </button>
          <button
            className={styles.secondaryButton}
            type="button"
            disabled={!project || !creator || catalog.loading || creating}
            onClick={() => void createSkill()}
          >
            <Sparkles size={14} />
            {creating ? t("skills.opening") : t("skills.create")}
          </button>
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!project || catalog.loading}
            onClick={() => void importSkill()}
          >
            <FolderInput size={14} />
            {t("skills.importFolder")}
          </button>
        </div>
      </header>

      {!project ? (
        <EmptyProject />
      ) : (
        <>
          <div className={styles.contextBar}>
            <strong>{project.displayName}</strong>
            <span>{project.canonicalPath}</span>
          </div>
          {catalog.error ? (
            <p className={styles.errorBanner}>{catalog.error}</p>
          ) : null}
          {catalog.warnings.length ? (
            <details className={styles.warningBlock}>
              <summary>
                {t("skills.discoveryWarnings", {
                  count: catalog.warnings.length,
                })}
              </summary>
              {catalog.warnings.map((warning, index) => (
                <p key={`${warning}-${index}`}>{warning}</p>
              ))}
            </details>
          ) : null}
          <div className={styles.splitView}>
            <div className={styles.listPane}>
              {catalog.skills.length ? (
                catalog.skills.map((skill) => (
                  <button
                    type="button"
                    key={skill.id}
                    data-active={catalog.selectedSkill?.id === skill.id}
                    data-status={skill.status}
                    onClick={() => void catalog.selectSkill(skill.id)}
                  >
                    <span className={styles.skillRowMeta}>
                      {skill.source.replace(":", " · ")}
                      <em data-status={skill.status}>{skill.status}</em>
                    </span>
                    <strong>
                      {skill.displayName ??
                        skill.name ??
                        t("skills.invalidSkill")}
                    </strong>
                    <small>
                      {skill.shortDescription ?? skill.description ?? skill.error}
                    </small>
                  </button>
                ))
              ) : (
                <p className={styles.emptyCopy}>
                  {t("skills.emptyNote")}
                </p>
              )}
            </div>
            <article className={styles.detailPane}>
              {catalog.selectedSkill ? (
                <>
                  <p className={styles.eyebrow}>
                    {catalog.selectedSkill.source.replace(":", " · ")}
                  </p>
                  <h2>
                    {catalog.selectedSkill.displayName ??
                      catalog.selectedSkill.name}
                  </h2>
                  <p>
                    {catalog.selectedSkill.shortDescription ??
                      catalog.selectedSkill.description}
                  </p>
                  <div className={styles.skillActions}>
                    <span
                      className={styles.badge}
                      data-status={catalog.selectedSkill.status}
                    >
                      {catalog.selectedSkill.status}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void catalog.setEnabled(
                          catalog.selectedSkill!.id,
                          !catalog.selectedSkill!.enabled,
                          scope,
                        )
                      }
                      disabled={catalog.loading}
                    >
                      <Power size={13} />
                      {catalog.selectedSkill.enabled
                        ? t("skills.disable")
                        : t("skills.enable")}
                    </button>
                    {catalog.selectedSkill.deletable ? (
                      <button
                        type="button"
                        className={styles.dangerButton}
                        disabled={catalog.loading}
                        onClick={() => {
                          const selected = catalog.selectedSkill;
                          if (
                            selected &&
                            window.confirm(
                              t("skills.deleteConfirm", {
                                name: selected.name,
                              }),
                            )
                          ) {
                            void catalog.deleteSkill(selected.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                        {t("skills.delete")}
                      </button>
                    ) : null}
                  </div>
                  <dl className={styles.metadata}>
                    <div>
                      <dt>{t("skills.location")}</dt>
                      <dd>{catalog.selectedSkill.location}</dd>
                    </div>
                    <div>
                      <dt>{t("skills.intendedTools")}</dt>
                      <dd>
                        {catalog.selectedSkill.allowedTools.join(", ") ||
                          t("skills.notDeclared")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("skills.invocation")}</dt>
                      <dd>
                        {catalog.selectedSkill.allowImplicitInvocation
                          ? t("skills.explicitOrAutomatic")
                          : t("skills.explicitOnly")}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("skills.revision")}</dt>
                      <dd>{catalog.selectedSkill.revision}</dd>
                    </div>
                  </dl>
                  {catalog.selectedSkill.error ? (
                    <p className={styles.errorBanner}>
                      {catalog.selectedSkill.error}
                    </p>
                  ) : null}
                  <MarkdownContent>
                    {catalog.selectedSkill.instructions}
                  </MarkdownContent>
                  {catalog.selectedSkill.truncated ? (
                    <p className={styles.note}>
                      {t("skills.instructionsTruncated")}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className={styles.emptyCopy}>
                  {t("skills.selectToInspect")}
                </p>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}

function EmptyProject() {
  const { t } = useTranslation();
  return (
    <div className={styles.emptyState}>
      <h2>{t("skills.openProjectFirst")}</h2>
      <p>{t("skills.runtimeNote")}</p>
    </div>
  );
}
