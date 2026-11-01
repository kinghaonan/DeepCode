import { Download, FlaskConical, RefreshCw, Rocket } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  ConfigScope,
  ExecutionAccessPreset,
  JsonObject,
  ModelCatalogResult,
  Project,
  ProviderTestResult,
  SettingsSnapshot,
} from "../../generated/app-server";
import {
  ACCESS_PRESET_OPTIONS,
  settingsDefaultAccessLabel,
} from "../../app/accessPreset";
import i18n from "../../i18n";
import { confirmAction } from "../../platform/confirmAction";
import type { DesktopRuntime } from "../../rpc/contracts";
import type {
  DesktopUpdateInfo,
  DesktopUpdateProgress,
} from "../../rpc/contracts";
import { useDiagnostics } from "./useDiagnostics";
import { useLanguage, type Language } from "../../i18n/language";
import { ConnectionSettings } from "./ConnectionSettings";
import { ConnectionVerification } from "./ConnectionVerification";
import {
  useConnectionCatalog,
  type ConnectionCatalogController,
} from "./useConnectionCatalog";
import styles from "../management/ManagementWorkspace.module.css";

interface SettingsPageProps {
  runtime: DesktopRuntime;
  project: Project | null;
  settings: SettingsSnapshot | null;
  busy: boolean;
  onRefresh(): Promise<void>;
  onUpdate(
    patch: JsonObject,
    scope: ConfigScope,
    riskAcknowledged?: boolean,
  ): Promise<void>;
}

interface AgentDraft {
  defaultConnection: string;
  defaultModel: string;
  planningConnection: string;
  planningModel: string;
  implementationConnection: string;
  implementationModel: string;
  maxTokens: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberText(value: unknown, fallback: number): string {
  return typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : String(fallback);
}

function agentDraft(settings: SettingsSnapshot | null): AgentDraft {
  const agents = record(settings?.agents);
  const defaults = record(agents.defaults);
  const planning = record(agents.planning);
  const implementation = record(agents.implementation);
  return {
    defaultConnection: text(
      defaults.connection,
      text(defaults.provider) === "auto" ? "" : text(defaults.provider),
    ),
    defaultModel: text(defaults.model),
    planningConnection: text(planning.connection),
    planningModel: text(planning.model),
    implementationConnection: text(implementation.connection),
    implementationModel: text(implementation.model),
    maxTokens: numberText(defaults.maxTokens, 8192),
  };
}

export function SettingsPage({
  runtime,
  project,
  settings,
  busy,
  onRefresh,
  onUpdate,
}: SettingsPageProps) {
  const [scope, setScope] = useState<ConfigScope>("user");
  const [agentOverrides, setAgentOverrides] = useState<Partial<AgentDraft>>({});
  const [accessPresetDraft, setAccessPresetDraft] = useState<
    ExecutionAccessPreset | null | undefined
  >(undefined);
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false);
  const [diagnosticsExportPath, setDiagnosticsExportPath] = useState<
    string | null
  >(null);
  const [diagnosticsExportError, setDiagnosticsExportError] = useState<
    string | null
  >(null);
  const [updateInfo, setUpdateInfo] = useState<DesktopUpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<
    "idle" | "checking" | "current" | "available" | "installing"
  >("idle");
  const [updateProgress, setUpdateProgress] =
    useState<DesktopUpdateProgress | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [verifyingModel, setVerifyingModel] = useState(false);
  const [modelVerification, setModelVerification] =
    useState<ProviderTestResult | null>(null);
  const diagnostics = useDiagnostics(runtime, project?.id ?? null);
  const connections = useConnectionCatalog(runtime, project?.id ?? null);
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();
  const canWriteProject = project?.trustState === "trusted";
  const effectiveScope =
    scope === "project" && canWriteProject ? "project" : "user";
  const agents = { ...agentDraft(settings), ...agentOverrides };
  const configuredAccessPreset =
    effectiveScope === "project"
      ? (settings?.projectAccessPreset ?? null)
      : (settings?.userAccessPreset ?? null);
  const accessPreset =
    accessPresetDraft === undefined
      ? configuredAccessPreset
      : accessPresetDraft;
  const maxTokens = Number(agents.maxTokens);
  const maxTokensValid =
    /^\d+$/.test(agents.maxTokens.trim()) &&
    Number.isSafeInteger(maxTokens) &&
    maxTokens > 0;

  const models = settings?.models ?? [];
  const connectionOptions = connections.catalog?.connections ?? [];
  const selectableConnections = connectionOptions.filter(
    (connection) =>
      connection.enabled &&
      (connection.id === agents.defaultConnection ||
        (connection.configured && (!connection.local || connection.explicit))),
  );
  const verificationConnection = resolveConnectionForModel(
    connectionOptions,
    agents.defaultConnection,
    agents.defaultModel,
  );

  const updateAgents = (patch: Partial<AgentDraft>) => {
    setAgentOverrides((current) => ({ ...current, ...patch }));
    setModelVerification(null);
  };

  const saveAgents = async (): Promise<boolean> => {
    if (!maxTokensValid) return false;
    await onUpdate(
      {
        agents: {
          defaults: {
            connection: agents.defaultConnection || null,
            provider: "auto",
            model: agents.defaultModel,
            maxTokens,
          },
          planning: {
            connection: agents.planningConnection || null,
            model: agents.planningModel || null,
          },
          implementation: {
            connection: agents.implementationConnection || null,
            model: agents.implementationModel || null,
          },
        },
      },
      effectiveScope,
    );
    setAgentOverrides({});
    return true;
  };

  const verifyDefaultModel = async () => {
    if (!verificationConnection || !agents.defaultModel.trim()) return;
    setVerifyingModel(true);
    setModelVerification(null);
    try {
      if (!(await saveAgents())) return;
      setModelVerification(
        await connections.test(
          verificationConnection.id,
          agents.defaultModel.trim(),
        ),
      );
    } catch {
      // The shared connection controller exposes the sanitized product error.
    } finally {
      setVerifyingModel(false);
    }
  };

  const saveSecurity = async () => {
    if (
      accessPreset === "full_access" &&
      !(await confirmAction(
        t("settings.fullAccessConfirmMessage"),
        {
          title: t("settings.fullAccessConfirmTitle"),
          kind: "warning",
          confirmLabel: t("settings.fullAccessConfirmLabel"),
          cancelLabel: t("common.cancel"),
        },
      ))
    ) {
      return;
    }
    await onUpdate(
      {
        security: {
          accessPreset,
        },
      },
      effectiveScope,
      accessPreset === "full_access",
    );
    setAccessPresetDraft(undefined);
  };

  const refresh = async () => {
    await onRefresh();
    setAgentOverrides({});
    setAccessPresetDraft(undefined);
    setModelVerification(null);
  };

  const exportDiagnostics = async () => {
    if (!diagnostics.diagnostics) return;
    setExportingDiagnostics(true);
    setDiagnosticsExportPath(null);
    setDiagnosticsExportError(null);
    try {
      const path = await runtime.exportDiagnostics(diagnostics.diagnostics);
      if (path) setDiagnosticsExportPath(path);
    } catch (cause) {
      setDiagnosticsExportError(
        cause instanceof Error ? cause.message : String(cause),
      );
    } finally {
      setExportingDiagnostics(false);
    }
  };

  const checkForUpdate = async () => {
    setUpdateState("checking");
    setUpdateInfo(null);
    setUpdateProgress(null);
    setUpdateError(null);
    try {
      const update = await runtime.checkForUpdate();
      setUpdateInfo(update);
      setUpdateState(update ? "available" : "current");
    } catch (cause) {
      setUpdateState("idle");
      setUpdateError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const installUpdate = async () => {
    setUpdateState("installing");
    setUpdateProgress(null);
    setUpdateError(null);
    try {
      await runtime.installUpdate(setUpdateProgress);
    } catch (cause) {
      setUpdateState("available");
      setUpdateError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <section className={styles.page} aria-labelledby="settings-title">
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>{t("settings.eyebrowRuntime")}</p>
          <h1 id="settings-title">{t("settings.title")}</h1>
          <p>{t("settings.description")}</p>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} />
          {t("settings.reload")}
        </button>
      </header>

      <ConnectionSettings controller={connections} busy={busy} />

      <div className={styles.scopeBar}>
        <label>
          {t("settings.writeChangesTo")}
          <select
            value={effectiveScope}
            onChange={(event) => {
              setScope(event.target.value as ConfigScope);
              setAccessPresetDraft(undefined);
            }}
          >
            <option value="user">{t("settings.userConfig")}</option>
            <option value="project" disabled={!project || !canWriteProject}>
              {t("settings.selectedProject")}
            </option>
          </select>
        </label>
        <span>
          {effectiveScope === "project"
            ? project?.canonicalPath
            : (settings?.configPath ?? t("settings.userConfigFallback"))}
        </span>
      </div>

      <div className={styles.settingsGrid}>
        <section className={`${styles.formCard} ${styles.fullWidthCard}`}>
          <header>
            <div>
              <p className={styles.eyebrow}>{t("settings.step2ChooseDefault")}</p>
              <h2>{t("settings.agentModel")}</h2>
              <p className={styles.cardDescription}>
                {t("settings.agentModelDescription")}
              </p>
            </div>
          </header>
          {!selectableConnections.length ? (
            <p className={styles.warningBlock}>
              {t("settings.connectProviderFirst")}
            </p>
          ) : null}
          <div className={styles.formGrid}>
            <label>
              {t("settings.providerConnection")}
              <select
                value={agents.defaultConnection}
                onChange={(event) =>
                  updateAgents({
                    defaultConnection: event.target.value,
                    defaultModel: "",
                  })
                }
              >
                <option value="">{t("settings.chooseAutomatically")}</option>
                {selectableConnections.map((connection) => (
                  <option value={connection.id} key={connection.id}>
                    {connection.label}
                  </option>
                ))}
              </select>
            </label>
            <ModelField
              label={t("settings.model")}
              connectionId={verificationConnection?.id ?? ""}
              value={agents.defaultModel}
              fallbackModels={models.map((model) => model.id)}
              listModels={connections.models}
              onChange={(defaultModel) => updateAgents({ defaultModel })}
            />
            <label>
              {t("settings.maxOutputTokens")}
              <input
                inputMode="numeric"
                value={agents.maxTokens}
                onChange={(event) =>
                  updateAgents({ maxTokens: event.target.value })
                }
                aria-invalid={!maxTokensValid}
              />
            </label>
          </div>
          <details className={styles.advancedSettings}>
            <summary>{t("settings.advancedPhaseRouting")}</summary>
            <p>{t("settings.phaseRoutingDescription")}</p>
            <div className={styles.formGrid}>
              <label>
                {t("settings.planningConnection")}
                <select
                  value={agents.planningConnection}
                  onChange={(event) =>
                    updateAgents({
                      planningConnection: event.target.value,
                      planningModel: "",
                    })
                  }
                >
                  <option value="">{t("settings.useAgentDefault")}</option>
                  {selectableConnections.map((connection) => (
                    <option value={connection.id} key={connection.id}>
                      {connection.label}
                    </option>
                  ))}
                </select>
              </label>
              <ModelField
                label={t("settings.planningModel")}
                connectionId={
                  agents.planningConnection || verificationConnection?.id || ""
                }
                value={agents.planningModel}
                fallbackModels={models.map((model) => model.id)}
                listModels={connections.models}
                allowEmpty
                onChange={(planningModel) => updateAgents({ planningModel })}
              />
              <label>
                {t("settings.implementationConnection")}
                <select
                  value={agents.implementationConnection}
                  onChange={(event) =>
                    updateAgents({
                      implementationConnection: event.target.value,
                      implementationModel: "",
                    })
                  }
                >
                  <option value="">{t("settings.useAgentDefault")}</option>
                  {selectableConnections.map((connection) => (
                    <option value={connection.id} key={connection.id}>
                      {connection.label}
                    </option>
                  ))}
                </select>
              </label>
              <ModelField
                label={t("settings.implementationModel")}
                connectionId={
                  agents.implementationConnection ||
                  verificationConnection?.id ||
                  ""
                }
                value={agents.implementationModel}
                fallbackModels={models.map((model) => model.id)}
                listModels={connections.models}
                allowEmpty
                onChange={(implementationModel) =>
                  updateAgents({ implementationModel })
                }
              />
            </div>
          </details>
          {modelVerification ? (
            <div className={styles.verificationBlock}>
              <ConnectionVerification result={modelVerification} />
            </div>
          ) : null}
          <footer className={styles.formActions}>
            <span>{t("settings.verificationNote")}</span>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={busy || !agents.defaultModel || !maxTokensValid}
              onClick={() => void saveAgents()}
            >
              {t("settings.saveDefaults")}
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={
                busy ||
                verifyingModel ||
                !verificationConnection ||
                !agents.defaultModel ||
                !maxTokensValid
              }
              onClick={() => void verifyDefaultModel()}
            >
              <FlaskConical size={13} />
              {verifyingModel
                ? t("settings.verifying")
                : t("settings.saveAndVerifyModel")}
            </button>
          </footer>
        </section>

        <section className={styles.formCard}>
          <header>
            <div>
              <p className={styles.eyebrow}>{t("settings.safetyPolicy")}</p>
              <h2>{t("settings.permissions")}</h2>
            </div>
          </header>
          <div className={styles.formGrid}>
            <label>
              {t("settings.defaultSessionAccess")}
              <select
                value={accessPreset ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  setAccessPresetDraft(
                    value ? (value as ExecutionAccessPreset) : null,
                  );
                }}
              >
                <option value="">
                  {effectiveScope === "project"
                    ? t("settings.inheritUserDefault")
                    : t("settings.useResolvedFallback", {
                        label: settingsDefaultAccessLabel(settings),
                      })}
                </option>
                {ACCESS_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className={styles.note}>
            {t("settings.effectiveDefault", {
              label: settingsDefaultAccessLabel(settings),
              source:
                settings?.resolvedDefaultSecuritySource.replaceAll("_", " ") ??
                t("settings.loadingSource"),
            })}
            . {t("settings.permissionsNote")}
          </p>
          <footer className={styles.formActions}>
            <span>{t("settings.permissionsFooterNote")}</span>
            <button
              className={styles.primaryButton}
              type="button"
              disabled={busy || accessPresetDraft === undefined}
              onClick={() => void saveSecurity()}
            >
              {t("settings.saveSafetySettings")}
            </button>
          </footer>
        </section>

        <section className={styles.formCard}>
          <header>
            <div>
              <p className={styles.eyebrow}>{t("settings.language.eyebrow")}</p>
              <h2>{t("settings.language.title")}</h2>
              <p className={styles.cardDescription}>
                {t("settings.language.description")}
              </p>
            </div>
          </header>
          <div className={styles.formGrid}>
            <label>
              {t("settings.language.displayLanguage")}
              <select
                value={language}
                onChange={(event) =>
                  setLanguage(event.target.value as Language)
                }
              >
                <option value="zh-CN">{t("settings.language.zh")}</option>
                <option value="en-US">{t("settings.language.en")}</option>
              </select>
            </label>
          </div>
        </section>
      </div>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t("settings.signedReleaseChannel")}</p>
            <h2>{t("settings.applicationUpdates")}</h2>
          </div>
          <div className={styles.headerActions}>
            {updateInfo ? (
              <button
                className={styles.primaryButton}
                type="button"
                disabled={updateState === "installing"}
                onClick={() => void installUpdate()}
              >
                <Download size={14} />
                {updateState === "installing"
                  ? updateProgressLabel(updateProgress)
                  : t("settings.installVersion", { version: updateInfo.version })}
              </button>
            ) : null}
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={
                updateState === "checking" || updateState === "installing"
              }
              onClick={() => void checkForUpdate()}
            >
              <Rocket size={14} />
              {updateState === "checking"
                ? t("settings.checking")
                : t("settings.checkForUpdates")}
            </button>
          </div>
        </header>
        {updateError ? (
          <p className={styles.errorBanner}>{updateError}</p>
        ) : null}
        <p className={styles.note}>
          {updateStatusMessage(updateState, updateInfo, updateProgress)}
        </p>
        {updateInfo?.body ? <p>{updateInfo.body}</p> : null}
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <div>
            <p className={styles.eyebrow}>{t("settings.troubleshooting")}</p>
            <h2>{t("settings.diagnostics")}</h2>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={!diagnostics.diagnostics || exportingDiagnostics}
              onClick={() => void exportDiagnostics()}
            >
              <Download size={14} />
              {exportingDiagnostics
                ? t("settings.exporting")
                : t("settings.exportReport")}
            </button>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={diagnostics.loading}
              onClick={() => void diagnostics.refresh()}
            >
              <RefreshCw size={14} />
              {t("settings.runChecks")}
            </button>
          </div>
        </header>
        {diagnostics.error ? (
          <p className={styles.errorBanner}>{diagnostics.error}</p>
        ) : null}
        {diagnosticsExportError ? (
          <p className={styles.errorBanner}>{diagnosticsExportError}</p>
        ) : null}
        {diagnosticsExportPath ? (
          <p className={styles.note}>
            {t("settings.diagnosticsSaved", { path: diagnosticsExportPath })}
          </p>
        ) : null}
        {diagnostics.diagnostics ? (
          <>
            <div className={styles.checkList}>
              {diagnostics.diagnostics.checks.map((check) => (
                <article key={check.id} data-status={check.status}>
                  <span />
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                  </div>
                </article>
              ))}
            </div>
            <dl className={styles.diagnosticGrid}>
              <Diagnostic
                label={t("settings.diagApp")}
                value={diagnostics.diagnostics.appVersion}
              />
              <Diagnostic
                label={t("settings.diagPython")}
                value={`${diagnostics.diagnostics.pythonVersion} · ${diagnostics.diagnostics.architecture}`}
              />
              <Diagnostic
                label={t("settings.diagSessions")}
                value={`${diagnostics.diagnostics.sessionCount} · ${diagnostics.diagnostics.sessionStorePath}`}
              />
              <Diagnostic
                label={t("settings.diagDesktopDb")}
                value={`schema ${diagnostics.diagnostics.databaseSchemaVersion} · ${diagnostics.diagnostics.databasePath}`}
              />
              <Diagnostic
                label={t("settings.diagPlatform")}
                value={diagnostics.diagnostics.platform}
              />
              <Diagnostic
                label={t("settings.diagAutomations")}
                value={String(diagnostics.diagnostics.automationCount)}
              />
              <Diagnostic
                label={t("settings.diagProjectConfig")}
                value={
                  diagnostics.diagnostics.projectConfigPath ??
                  t("settings.noProjectSelected")
                }
              />
            </dl>
          </>
        ) : null}
      </section>

      <aside
        className={styles.credits}
        aria-label={t("settings.visualCredits")}
      >
        <span className={styles.creditMark} aria-hidden="true" />
        <p>
          <strong>{t("settings.visualCredits")}</strong>
          <small>{t("settings.visualCreditsNote")}</small>
        </p>
      </aside>
    </section>
  );
}

function updateProgressLabel(progress: DesktopUpdateProgress | null): string {
  if (!progress || progress.phase === "started")
    return i18n.t("settings.updatePreparing");
  if (progress.phase === "finished") return i18n.t("settings.updateInstalling");
  if (!progress.totalBytes) return i18n.t("settings.updateDownloading");
  const percentage = Math.min(
    100,
    Math.round((progress.downloadedBytes / progress.totalBytes) * 100),
  );
  return i18n.t("settings.updateDownloadingPercent", { percentage });
}

function updateStatusMessage(
  state: "idle" | "checking" | "current" | "available" | "installing",
  update: DesktopUpdateInfo | null,
  progress: DesktopUpdateProgress | null,
): string {
  if (state === "checking")
    return i18n.t("settings.updateCheckingChannel");
  if (state === "current") return i18n.t("settings.updateUpToDate");
  if (state === "available" && update) {
    return i18n.t("settings.updateAvailable", { version: update.version });
  }
  if (state === "installing") return updateProgressLabel(progress);
  return i18n.t("settings.updateIdleNote");
}

function ModelField({
  label,
  connectionId,
  value,
  fallbackModels,
  listModels,
  allowEmpty = false,
  onChange,
}: {
  label: string;
  connectionId: string;
  value: string;
  fallbackModels: string[];
  listModels: ConnectionCatalogController["models"];
  allowEmpty?: boolean;
  onChange(value: string): void;
}) {
  const listId = useId();
  const { t } = useTranslation();
  const [catalogState, setCatalogState] = useState<{
    connectionId: string;
    catalog: ModelCatalogResult | null;
    failed: boolean;
  } | null>(null);

  useEffect(() => {
    if (!connectionId) return;
    let cancelled = false;
    void listModels(connectionId)
      .then((result) => {
        if (!cancelled) {
          setCatalogState({ connectionId, catalog: result, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCatalogState({ connectionId, catalog: null, failed: true });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [connectionId, listModels]);

  const catalog =
    catalogState?.connectionId === connectionId ? catalogState.catalog : null;
  const loading = Boolean(
    connectionId && catalogState?.connectionId !== connectionId,
  );
  const models =
    catalog?.connectionId === connectionId
      ? catalog.models.map((model) => model.id)
      : fallbackModels;
  return (
    <label>
      {label}
      <input
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={
          allowEmpty ? t("settings.useDefault") : t("settings.providerModelId")
        }
      />
      <datalist id={listId}>
        {models.map((model) => (
          <option value={model} key={model} />
        ))}
      </datalist>
      <small>
        {loading
          ? t("settings.loadingModels")
          : catalogState?.connectionId === connectionId && catalogState.failed
            ? t("settings.catalogUnavailable")
            : catalog?.stale
              ? t("settings.usingLastModelList")
              : connectionId
                ? t("settings.modelsAvailable", { count: models.length })
                : t("settings.chooseConnectionForModels")}
      </small>
    </label>
  );
}

function resolveConnectionForModel(
  connections: NonNullable<
    ConnectionCatalogController["catalog"]
  >["connections"],
  selectedId: string,
  model: string,
) {
  if (selectedId) {
    const selected = connections.find(
      (connection) => connection.id === selectedId && connection.enabled,
    );
    if (selected) return selected;
  }
  const prefix = model.split("/", 1)[0]?.toLocaleLowerCase();
  return (
    connections.find(
      (connection) =>
        connection.enabled &&
        connection.configured &&
        (connection.id === prefix || connection.providerName === prefix),
    ) ??
    connections.find(
      (connection) => connection.enabled && connection.configured,
    ) ??
    null
  );
}

function Diagnostic({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
