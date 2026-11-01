import {
  ChevronLeft,
  FlaskConical,
  KeyRound,
  Plus,
  Save,
  Server,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  ConnectionInfo,
  ProviderTestResult,
  ProviderUpsertParams,
} from "../../generated/app-server";
import i18n from "../../i18n";
import { confirmAction } from "../../platform/confirmAction";
import type { ConnectionCatalogController } from "./useConnectionCatalog";
import { ConnectionVerification } from "./ConnectionVerification";
import styles from "./ConnectionSettings.module.css";

interface ConnectionSettingsProps {
  controller: ConnectionCatalogController;
  busy: boolean;
}

interface Draft {
  id: string;
  label: string;
  template: string;
  adapter: "openai_compat" | "anthropic";
  apiBase: string;
  apiKeyEnv: string;
  apiKey: string;
  credentialMode: "key" | "environment";
  clearApiKey: boolean;
  modelCatalog: "auto" | "openrouter" | "openai" | "anthropic" | "manual";
  manualModels: string;
}

const emptyDraft: Draft = {
  id: "",
  label: "",
  template: "",
  adapter: "openai_compat",
  apiBase: "",
  apiKeyEnv: "",
  apiKey: "",
  credentialMode: "key",
  clearApiKey: false,
  modelCatalog: "auto",
  manualModels: "",
};

export function ConnectionSettings({
  controller,
  busy,
}: ConnectionSettingsProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, ProviderTestResult>
  >({});
  const connections = useMemo(
    () =>
      [...(controller.catalog?.connections ?? [])].sort(
        (left, right) =>
          Number(right.configured) - Number(left.configured) ||
          left.label.localeCompare(right.label),
      ),
    [controller.catalog?.connections],
  );
  const selectedTemplate = controller.catalog?.templates.find(
    (template) => template.name === editing?.template,
  );
  const editingExisting = Boolean(
    editing &&
    connections.some(
      (connection) =>
        connection.id === editing.id &&
        (connection.configured || connection.explicit),
    ),
  );
  const endpointRequired = Boolean(selectedTemplate?.requiresApiBase);

  const beginEdit = (connection: ConnectionInfo) => {
    setEditing({
      id: connection.id,
      label: connection.label,
      template: connection.providerName,
      adapter: connection.adapter,
      apiBase: connection.apiBase ?? "",
      apiKeyEnv: connection.apiKeyEnv ?? "",
      apiKey: "",
      credentialMode: connection.apiKeyEnv ? "environment" : "key",
      clearApiKey: false,
      modelCatalog: connection.modelCatalog,
      manualModels: connection.manualModels.join("\n"),
    });
  };

  const chooseTemplate = (templateName: string) => {
    const template = controller.catalog?.templates.find(
      (candidate) => candidate.name === templateName,
    );
    if (!template) return;
    const builtin = connections.find(
      (connection) => connection.id === template.name && !connection.configured,
    );
    const id = builtin?.id ?? nextConnectionId(template.name, connections);
    setEditing((current) => ({
      ...(current ?? emptyDraft),
      id,
      label: template.label,
      template: template.name,
      adapter: template.adapter === "anthropic" ? "anthropic" : "openai_compat",
      apiBase: template.defaultApiBase ?? "",
      modelCatalog: "auto",
      manualModels: "",
    }));
  };

  const save = async () => {
    if (!editing?.id.trim()) return;
    setSaving(true);
    try {
      const connectionId = editing.id.trim().toLocaleLowerCase();
      const connection: ProviderUpsertParams["connection"] = {
        id: connectionId,
        label: editing.label.trim() || editing.id.trim(),
        template: editing.template,
        adapter: editing.adapter,
        apiBase: editing.apiBase.trim() || null,
        apiKeyEnv:
          editing.credentialMode === "environment"
            ? editing.apiKeyEnv.trim() || null
            : null,
        modelCatalog: editing.modelCatalog,
        manualModels: editing.manualModels
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter(Boolean),
        enabled: true,
      };
      if (editing.credentialMode === "key" && editing.apiKey.trim()) {
        connection.apiKey = editing.apiKey.trim();
      }
      if (editing.clearApiKey) connection.clearApiKey = true;
      await controller.upsert(connection);
      setEditing(null);
      setTestingId(connectionId);
      try {
        const result = await controller.test(connectionId);
        setTestResults((current) => ({ ...current, [connectionId]: result }));
      } finally {
        setTestingId(null);
      }
    } catch {
      // The shared controller owns the sanitized user-facing error.
    } finally {
      setSaving(false);
    }
  };

  const test = async (connectionId: string) => {
    setTestingId(connectionId);
    try {
      const result = await controller.test(connectionId);
      setTestResults((current) => ({ ...current, [connectionId]: result }));
    } catch {
      // The shared controller owns the sanitized user-facing error.
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (connection: ConnectionInfo) => {
    if (
      !(await confirmAction(
        t("settings.removeConnectionMessage", { label: connection.label }),
        {
          title: t("settings.removeConnectionTitle"),
          confirmLabel: t("settings.removeConnectionConfirm"),
          kind: "warning",
        },
      ))
    ) {
      return;
    }
    try {
      await controller.remove(connection.id);
    } catch {
      // The shared controller owns the sanitized user-facing error.
    }
  };

  return (
    <section className={styles.section} aria-labelledby="connections-title">
      <header className={styles.heading}>
        <div>
          <p>{t("settings.step1ConnectProvider")}</p>
          <h2 id="connections-title">{t("settings.aiProviders")}</h2>
          <span>{t("settings.aiProvidersDescription")}</span>
        </div>
        <button
          type="button"
          className={styles.addButton}
          onClick={() => setEditing({ ...emptyDraft })}
          disabled={busy || saving}
        >
          <Plus size={14} />
          {t("settings.addProvider")}
        </button>
      </header>

      {controller.error ? (
        <p className={styles.error}>{controller.error}</p>
      ) : null}

      <div className={styles.connectionRail}>
        {connections.filter(isManagedConnection).map((connection) => {
          const result = testResults[connection.id];
          return (
            <article key={connection.id} className={styles.connection}>
              <span
                className={styles.statusLight}
                data-status={
                  result?.status ??
                  (connection.configured ? "configured" : "error")
                }
                aria-hidden="true"
              />
              <div className={styles.connectionBody}>
                <header>
                  <div>
                    <strong>{connection.label}</strong>
                    <code>{connection.id}</code>
                  </div>
                  <span data-status={result?.status ?? "configured"}>
                    {connectionStatus(connection, result)}
                  </span>
                </header>
                <p>
                  {connection.apiBase ?? t("settings.providerDefaultEndpoint")}
                  <small>
                    {connection.adapter.replace("_", " ")} ·{" "}
                    {credentialLabel(connection)}
                  </small>
                </p>
                {result ? (
                  <ConnectionVerification result={result} compact />
                ) : null}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  onClick={() => void test(connection.id)}
                  disabled={busy || testingId === connection.id}
                  title={t("settings.checkCredentialCatalog")}
                >
                  <FlaskConical size={13} />
                  {testingId === connection.id
                    ? t("settings.checkingConnection")
                    : t("settings.check")}
                </button>
                <button
                  type="button"
                  onClick={() => beginEdit(connection)}
                  disabled={busy}
                >
                  {t("settings.edit")}
                </button>
                {connection.explicit ? (
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => void remove(connection)}
                    disabled={busy}
                    title={t("settings.removeConnection")}
                  >
                    <Trash2 size={13} />
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
        {!controller.loading && !connections.some(isManagedConnection) ? (
          <div className={styles.emptyState}>
            <Server size={20} />
            <strong>{t("settings.noProviderConnected")}</strong>
            <span>{t("settings.addProviderToBegin")}</span>
            <button type="button" onClick={() => setEditing({ ...emptyDraft })}>
              <Plus size={13} /> {t("settings.addProvider")}
            </button>
          </div>
        ) : null}
        {controller.loading ? (
          <p className={styles.loading}>{t("settings.loadingConnections")}</p>
        ) : null}
      </div>

      {editing ? (
        <div className={styles.editorBackdrop} role="presentation">
          <section
            className={styles.editor}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connection-editor-title"
          >
            <header>
              <div>
                <KeyRound size={16} />
                <span>
                  <strong id="connection-editor-title">
                    {editingExisting
                      ? t("settings.editProvider")
                      : t("settings.connectProvider")}
                  </strong>
                  <small>{t("settings.oneSetupCliDesktop")}</small>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setEditing(null)}
                aria-label={t("settings.closeConnectionEditor")}
              >
                <X size={15} />
              </button>
            </header>
            {!editing.template ? (
              <div className={styles.providerPicker}>
                <div>
                  <strong>{t("settings.chooseModelSource")}</strong>
                  <span>{t("settings.providerDefaultsNote")}</span>
                </div>
                <div className={styles.providerGrid}>
                  {controller.catalog?.templates.map((template) => (
                    <button
                      type="button"
                      key={template.name}
                      onClick={() => chooseTemplate(template.name)}
                    >
                      <Server size={16} />
                      <span>
                        <strong>{template.label}</strong>
                        <small>
                          {template.local
                            ? t("settings.runsLocally")
                            : t("settings.cloudProvider")}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.form}>
                {controller.error ? (
                  <p className={`${styles.error} ${styles.wide}`}>
                    {controller.error}
                  </p>
                ) : null}
                <div className={`${styles.providerSummary} ${styles.wide}`}>
                  <Server size={17} />
                  <span>
                    <strong>{selectedTemplate?.label ?? editing.label}</strong>
                    <small>
                      {selectedTemplate?.local
                        ? t("settings.localModelService")
                        : t("settings.apiProvider")}
                    </small>
                  </span>
                  {!editingExisting ? (
                    <button
                      type="button"
                      onClick={() => setEditing({ ...emptyDraft })}
                    >
                      <ChevronLeft size={12} /> {t("settings.change")}
                    </button>
                  ) : null}
                </div>
                <label className={styles.wide}>
                  {t("settings.displayName")}
                  <input
                    value={editing.label}
                    onChange={(event) =>
                      setEditing({ ...editing, label: event.target.value })
                    }
                    placeholder={selectedTemplate?.label ?? t("settings.myProvider")}
                  />
                </label>
                {endpointRequired ? (
                  <label className={styles.wide}>
                    {t("settings.apiEndpoint")}
                    <input
                      value={editing.apiBase}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          apiBase: event.target.value,
                        })
                      }
                      placeholder="https://llm.example.com/v1"
                      aria-required="true"
                    />
                    <small>{t("settings.endpointNote")}</small>
                  </label>
                ) : null}
                {!selectedTemplate?.local ? (
                  <fieldset className={`${styles.credentials} ${styles.wide}`}>
                    <legend>{t("settings.credentialLegend")}</legend>
                    <div className={styles.credentialTabs}>
                      <button
                        type="button"
                        data-active={editing.credentialMode === "key"}
                        onClick={() =>
                          setEditing({ ...editing, credentialMode: "key" })
                        }
                      >
                        {t("settings.pasteApiKey")}
                      </button>
                      <button
                        type="button"
                        data-active={editing.credentialMode === "environment"}
                        onClick={() =>
                          setEditing({
                            ...editing,
                            credentialMode: "environment",
                          })
                        }
                      >
                        {t("settings.environmentVariable")}
                      </button>
                    </div>
                    {editing.credentialMode === "key" ? (
                      <input
                        type="password"
                        value={editing.apiKey}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            apiKey: event.target.value,
                            clearApiKey: false,
                          })
                        }
                        placeholder={
                          editingExisting
                            ? t("settings.leaveBlankKeepKey")
                            : t("settings.pasteApiKey")
                        }
                        autoComplete="new-password"
                        disabled={editing.clearApiKey}
                        aria-label={t("settings.apiKey")}
                      />
                    ) : (
                      <input
                        value={editing.apiKeyEnv}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            apiKeyEnv: event.target.value,
                          })
                        }
                        placeholder={
                          selectedTemplate?.apiKeyEnv ?? "PROVIDER_API_KEY"
                        }
                        aria-label={t("settings.apiKeyEnv")}
                      />
                    )}
                    <small>{t("settings.storedKeysPrivate")}</small>
                  </fieldset>
                ) : null}
                <details className={`${styles.advanced} ${styles.wide}`}>
                  <summary>
                    <SlidersHorizontal size={13} />{" "}
                    {t("settings.advancedConnectionSettings")}
                  </summary>
                  <div>
                    <label>
                      {t("settings.connectionId")}
                      <input
                        value={editing.id}
                        onChange={(event) =>
                          setEditing({ ...editing, id: event.target.value })
                        }
                        placeholder="provider-personal"
                        disabled={editingExisting}
                      />
                    </label>
                    {!endpointRequired ? (
                      <label>
                        {t("settings.apiBase")}
                        <input
                          value={editing.apiBase}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              apiBase: event.target.value,
                            })
                          }
                          placeholder={t("settings.useProviderDefault")}
                        />
                      </label>
                    ) : null}
                    <label>
                      {t("settings.adapter")}
                      <select
                        value={editing.adapter}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            adapter: event.target.value as Draft["adapter"],
                          })
                        }
                      >
                        <option value="openai_compat">
                          {t("settings.openaiCompatible")}
                        </option>
                        <option value="anthropic">
                          {t("settings.anthropicNative")}
                        </option>
                      </select>
                    </label>
                    <label>
                      {t("settings.modelCatalog")}
                      <select
                        value={editing.modelCatalog}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            modelCatalog: event.target
                              .value as Draft["modelCatalog"],
                          })
                        }
                      >
                        <option value="auto">{t("settings.automatic")}</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="openai">
                          {t("settings.openaiCompatible")}
                        </option>
                        <option value="anthropic">Anthropic</option>
                        <option value="manual">{t("settings.manualList")}</option>
                      </select>
                    </label>
                    {editing.modelCatalog === "manual" ? (
                      <label className={styles.wide}>
                        {t("settings.manualModels")}
                        <textarea
                          value={editing.manualModels}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              manualModels: event.target.value,
                            })
                          }
                          placeholder={t("settings.manualModelsPlaceholder")}
                          rows={3}
                        />
                      </label>
                    ) : null}
                    {editingExisting ? (
                      <label
                        className={`${styles.credentialAction} ${styles.wide}`}
                      >
                        <input
                          type="checkbox"
                          checked={editing.clearApiKey}
                          aria-label={t("settings.removeSavedApiKey")}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              apiKey: event.target.checked
                                ? ""
                                : editing.apiKey,
                              clearApiKey: event.target.checked,
                            })
                          }
                        />
                        <span>
                          <strong>{t("settings.removeSavedKeyTitle")}</strong>
                          <small>{t("settings.removeKeyNote")}</small>
                        </span>
                      </label>
                    ) : null}
                  </div>
                </details>
              </div>
            )}
            <footer>
              <span>{t("settings.savingNote")}</span>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className={styles.saveButton}
                onClick={() => void save()}
                disabled={
                  saving ||
                  !editing.id.trim() ||
                  !editing.template ||
                  (endpointRequired && !editing.apiBase.trim())
                }
              >
                <Save size={13} />
                {saving ? t("settings.saving") : t("settings.saveAndCheck")}
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function credentialLabel(connection: ConnectionInfo): string {
  switch (connection.credentialSource) {
    case "environment":
      return connection.apiKeyEnv
        ? `${i18n.t("settings.credential.environment")} · ${connection.apiKeyEnv}`
        : i18n.t("settings.credential.environment");
    case "credential_store":
      return i18n.t("settings.credential.credentialStore");
    case "legacy_config":
      return i18n.t("settings.credential.legacyConfig");
    case "not_required":
      return i18n.t("settings.credential.notRequired");
    default:
      return i18n.t("settings.credential.none");
  }
}

function connectionStatus(
  connection: ConnectionInfo,
  result: ProviderTestResult | undefined,
): string {
  if (result?.status === "ready")
    return i18n.t("settings.connectionStatus.modelVerified");
  if (result?.status === "connected")
    return i18n.t("settings.connectionStatus.catalogConnected");
  if (result?.status === "limited")
    return i18n.t("settings.connectionStatus.modelCheckNeeded");
  if (result?.status === "error")
    return i18n.t("settings.connectionStatus.needsAttention");
  return connection.configured
    ? i18n.t("settings.connectionStatus.credentialSaved")
    : i18n.t("settings.connectionStatus.needsCredential");
}

function isManagedConnection(connection: ConnectionInfo): boolean {
  return connection.explicit || (connection.configured && !connection.local);
}

function nextConnectionId(
  template: string,
  connections: ConnectionInfo[],
): string {
  const existing = new Set(connections.map((connection) => connection.id));
  if (!existing.has(template)) return template;
  let suffix = 2;
  while (existing.has(`${template}-${suffix}`)) suffix += 1;
  return `${template}-${suffix}`;
}
