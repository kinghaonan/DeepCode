import {
  ArrowUp,
  Check,
  Paperclip,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";

import type {
  ExecutionAccessPreset,
  Goal,
  GoalOutcome,
  Project,
  SettingsSnapshot,
  Thread,
  Turn,
} from "../../generated/app-server";
import type { GoalDefinitionInput } from "../../app/useWorkspaceController";
import type { InteractiveDelivery } from "../../app/interactiveTurnRouter";
import {
  ACCESS_PRESET_OPTIONS,
  settingsDefaultAccessLabel,
  settingsProductAccessPreset,
  turnExecutionAccessLabel,
  turnExecutionAccessState,
} from "../../app/accessPreset";
import type { DesktopRuntime } from "../../rpc/contracts";
import type { TranscriptMode } from "../thread/transcriptMode";
import { useSkillCatalog } from "../skills/useSkillCatalog";
import { GoalRail } from "../goal/GoalRail";
import {
  matchingCommands,
  parseComposerCommand,
  type ComposerCommand,
} from "./commands";
import styles from "./Composer.module.css";
import { usePromptDraft } from "./usePromptDraft";
import { ModelPicker } from "./ModelPicker";
import { TranscriptModePicker } from "./TranscriptModePicker";

interface ComposerProps {
  editable: boolean;
  canExecute: boolean;
  busy: boolean;
  executingTurn: Turn | null;
  queuedTurns: readonly Turn[];
  runtime: DesktopRuntime;
  project: Project | null;
  thread: Thread | null;
  settings: SettingsSnapshot | null;
  goal: Goal | null;
  goalOutcome: GoalOutcome | null;
  goalTurns: readonly Turn[];
  disabledReason: string | null;
  transcriptMode: TranscriptMode;
  onTranscriptModeChange(mode: TranscriptMode): void;
  onModelChange(
    connectionId: string | null,
    model: string | null,
    reasoningEffort: string | null,
  ): void;
  onAccessPresetChange(preset: ExecutionAccessPreset | null): Promise<boolean>;
  onSetGoal(input: GoalDefinitionInput): Promise<void>;
  onPauseGoal(): Promise<void>;
  onResumeGoal(): Promise<void>;
  onContinueGoal(): Promise<void>;
  onClearGoal(): Promise<void>;
  onSelectGoalEvidence(itemId: string): void;
  onPickContextFiles(): Promise<string[]>;
  onCommand(command: ComposerCommand): Promise<boolean>;
  onSend(
    prompt: string,
    skillIds?: string[],
  ): Promise<InteractiveDelivery | null>;
  onQueue(prompt: string, skillIds?: string[]): Promise<boolean>;
  onInterrupt(): void;
  launchIntent: ComposerLaunchIntent | null;
  onLaunchIntentConsumed(): void;
}

export interface ComposerLaunchIntent {
  threadId: string;
  prompt: string;
  skillIds: string[];
}

export function Composer({
  editable,
  canExecute,
  busy,
  executingTurn,
  queuedTurns,
  runtime,
  project,
  thread,
  settings,
  goal,
  goalOutcome,
  goalTurns,
  disabledReason,
  transcriptMode,
  onTranscriptModeChange,
  onModelChange,
  onAccessPresetChange,
  onSetGoal,
  onPauseGoal,
  onResumeGoal,
  onContinueGoal,
  onClearGoal,
  onSelectGoalEvidence,
  onPickContextFiles,
  onCommand,
  onSend,
  onQueue,
  onInterrupt,
  launchIntent,
  onLaunchIntentConsumed,
}: ComposerProps) {
  const { t } = useTranslation();
  const active = executingTurn !== null;
  const initialLaunch =
    launchIntent && launchIntent.threadId === thread?.id ? launchIntent : null;
  const {
    prompt,
    setPrompt,
    record,
    browse,
    browsingHistory,
    attachments,
    addAttachments,
    removeAttachment,
    clearAttachments,
  } = usePromptDraft(
    thread?.id ?? "unselected",
    initialLaunch?.prompt,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillQuery, setSkillQuery] = useState("");
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>(() =>
    initialLaunch?.skillIds ?? [],
  );
  const [deliveryNotice, setDeliveryNotice] = useState<string | null>(null);
  const skillCatalog = useSkillCatalog(runtime, project?.id ?? null);
  const availableSkills = useMemo(() => {
    const query = skillQuery.trim().toLocaleLowerCase();
    return skillCatalog.activeSkills.filter(
      (skill) =>
        !query ||
        skill.name.toLocaleLowerCase().includes(query) ||
        skill.description.toLocaleLowerCase().includes(query) ||
        skill.displayName?.toLocaleLowerCase().includes(query) ||
        skill.shortDescription?.toLocaleLowerCase().includes(query),
    );
  }, [skillCatalog.activeSkills, skillQuery]);
  const selectedSkills = useMemo(() => {
    if (active) return [];
    const byId = new Map(skillCatalog.skills.map((skill) => [skill.id, skill]));
    return selectedSkillIds.flatMap((skillId) => {
      const skill = byId.get(skillId);
      return skill ? [skill] : [];
    });
  }, [active, selectedSkillIds, skillCatalog.skills]);
  const accessPresetOverride = thread?.accessPresetOverride ?? null;
  const effectiveProductAccess =
    accessPresetOverride ?? settingsProductAccessPreset(settings);
  const defaultAccessLabel = settingsDefaultAccessLabel(settings);
  const executingAccessLabel = executingTurn
    ? turnExecutionAccessLabel(executingTurn)
    : null;
  const executingAccessState = executingTurn
    ? turnExecutionAccessState(executingTurn)
    : null;
  const queuedAccessLabels = [
    ...new Set(queuedTurns.map(turnExecutionAccessLabel)),
  ];
  const queuedAccessStates = queuedTurns.map(turnExecutionAccessState);
  const queuedAccessState = queuedAccessStates.includes("full_access")
    ? "full_access"
    : new Set(queuedAccessStates).size === 1
      ? queuedAccessStates[0]
      : "mixed";

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 190)}px`;
  }, [prompt]);

  useEffect(() => {
    if (!initialLaunch) return;
    textareaRef.current?.focus();
    onLaunchIntentConsumed();
  }, [initialLaunch, onLaunchIntentConsumed]);

  const submit = async () => {
    const value = prompt.trim();
    if (!value || !canExecute || busy) return;
    const parsed = parseComposerCommand(value);
    if (parsed) {
      if (!parsed.ok) {
        setCommandError(parsed.message);
        return;
      }
      record(value);
      if (!(await onCommand(parsed.command))) return;
      setPrompt("");
      setCommandError(null);
      return;
    }
    record(value);
    const executionPrompt = withContextFiles(
      value,
      attachments,
      thread?.workspacePath,
      t("composer.attachedWorkspaceContext"),
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    const delivery = await onSend(executionPrompt, selectedIds);
    if (!delivery) return;
    setDeliveryNotice(
      delivery === "steered"
        ? t("composer.updateDelivered")
        : delivery === "queued"
          ? t("composer.queuedNextTurn")
          : t("composer.startedNewTurn"),
    );
    setPrompt("");
    clearAttachments();
    if (delivery !== "steered") setSelectedSkillIds([]);
    setSkillPickerOpen(false);
  };

  const submitQueued = async () => {
    const value = prompt.trim();
    if (!value || !canExecute || busy) return;
    if (parseComposerCommand(value)) {
      await submit();
      return;
    }
    const executionPrompt = withContextFiles(
      value,
      attachments,
      thread?.workspacePath,
      t("composer.attachedWorkspaceContext"),
    );
    const selectable = new Set(skillCatalog.activeSkills.map((skill) => skill.id));
    const selectedIds = selectedSkillIds.filter((skillId) =>
      selectable.has(skillId),
    );
    if (!(await onQueue(executionPrompt, selectedIds))) return;
    record(value);
    setDeliveryNotice(t("composer.queuedNextTurn"));
    setPrompt("");
    clearAttachments();
    setSelectedSkillIds([]);
    setSkillPickerOpen(false);
  };
  const commandSuggestions = matchingCommands(prompt);

  const pickContextFiles = async () => {
    setContextError(null);
    const selected = await onPickContextFiles();
    const workspace = thread?.workspacePath;
    const accepted = workspace
      ? selected.filter((path) => isInsideWorkspace(path, workspace))
      : [];
    if (accepted.length !== selected.length) {
      setContextError(t("composer.attachWorkspaceOnly"));
    }
    addAttachments(accepted);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void submit();
      return;
    }
    if (
      event.key === "ArrowUp" &&
      (!prompt || browsingHistory) &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      browse("older");
    } else if (
      event.key === "ArrowDown" &&
      browsingHistory &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      browse("newer");
    }
  };

  return (
    <footer className={styles.region}>
      <GoalRail
        goal={goal}
        outcome={goalOutcome}
        turns={goalTurns}
        enabled={canExecute}
        busy={busy}
        skills={skillCatalog.activeSkills}
        onSet={onSetGoal}
        onPause={onPauseGoal}
        onResume={onResumeGoal}
        onContinue={onContinueGoal}
        onClear={onClearGoal}
        onSelectEvidence={onSelectGoalEvidence}
      />
      <div className={styles.composer}>
        <label className={styles.promptLabel} htmlFor="turn-prompt">
          {t("composer.taskInstruction")}
        </label>
        <textarea
          ref={textareaRef}
          id="turn-prompt"
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            setCommandError(null);
            setDeliveryNotice(null);
          }}
          onKeyDown={onKeyDown}
          placeholder={
            active
              ? t("composer.placeholderActive")
              : t("composer.placeholderIdle")
          }
          rows={1}
          disabled={!editable}
        />
        {commandSuggestions.length ? (
          <div
            className={styles.commandMenu}
            role="listbox"
            aria-label={t("composer.commandsAria")}
          >
            {commandSuggestions.map((command) => (
              <button
                type="button"
                role="option"
                aria-selected={false}
                key={command.name}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setPrompt(command.usage);
                  textareaRef.current?.focus();
                }}
              >
                <code>/{command.name}</code>
                <span>{command.description}</span>
              </button>
            ))}
          </div>
        ) : null}
        {skillPickerOpen && !active ? (
          <section
            className={styles.skillMenu}
            aria-label={t("composer.selectSkills")}
          >
            <header>
              <div>
                <strong>{t("composer.skillsForTurn")}</strong>
                <span>{t("composer.skillsHint")}</span>
              </div>
              <button
                type="button"
                onClick={() => setSkillPickerOpen(false)}
                aria-label={t("composer.closeSkillPicker")}
              >
                <X size={13} />
              </button>
            </header>
            <input
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder={t("composer.filterSkills")}
              aria-label={t("composer.filterSkills")}
              autoFocus
            />
            <div className={styles.skillOptions} role="listbox" aria-multiselectable>
              {availableSkills.length ? (
                availableSkills.map((skill) => {
                  const selected = selectedSkillIds.includes(skill.id);
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      key={skill.id}
                      onClick={() =>
                        setSelectedSkillIds((current) => {
                          const selectable = new Set(
                            skillCatalog.activeSkills.map((entry) => entry.id),
                          );
                          const valid = current.filter((skillId) =>
                            selectable.has(skillId),
                          );
                          return selected
                            ? valid.filter((skillId) => skillId !== skill.id)
                            : valid.length < 8
                              ? [...valid, skill.id]
                              : valid;
                        })
                      }
                    >
                      <span className={styles.skillCheck}>
                        {selected ? <Check size={11} /> : null}
                      </span>
                      <span>
                        <strong>{skill.displayName ?? skill.name}</strong>
                        <small>
                          {skill.shortDescription ?? skill.description}
                        </small>
                      </span>
                      <em>{skill.source.replace(":", " · ")}</em>
                    </button>
                  );
                })
              ) : (
                <p>
                  {skillCatalog.loading
                    ? t("composer.loadingSkills")
                    : skillCatalog.error ?? t("composer.noMatchingSkills")}
                </p>
              )}
            </div>
          </section>
        ) : null}
        {selectedSkills.length ? (
          <div className={styles.skills} aria-label={t("composer.selectedSkills")}>
            {selectedSkills.map((skill) => (
              <span
                key={skill.id}
                title={skill.shortDescription ?? skill.description}
              >
                <Sparkles size={11} />
                {skill.displayName ?? skill.name}
                <button
                  type="button"
                  onClick={() =>
                    setSelectedSkillIds((current) =>
                      current.filter((skillId) => skillId !== skill.id),
                    )
                  }
                  aria-label={t("composer.removeSkillWithName", { name: skill.name })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {attachments.length ? (
          <div
            className={styles.attachments}
            aria-label={t("composer.attachedContextFiles")}
          >
            {attachments.map((path) => (
              <span key={path} title={path}>
                <Paperclip size={11} />
                {fileName(path)}
                <button
                  type="button"
                  onClick={() => removeAttachment(path)}
                  aria-label={t("composer.removeAttachmentWithName", {
                    name: fileName(path),
                  })}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {executingTurn || queuedTurns.length ? (
          <div
            className={styles.accessStatusRail}
            aria-label={t("composer.frozenTurnAccess")}
          >
            <div className={styles.accessStatuses}>
              {executingTurn && executingAccessLabel ? (
                <span
                  className={styles.accessStatus}
                  data-access={executingAccessState}
                  aria-label={t("composer.currentTurnAccess", {
                    access: executingAccessLabel,
                  })}
                >
                  <strong>{t("composer.currentTurn")}</strong>
                  <i aria-hidden="true">·</i>
                  {executingAccessLabel}
                </span>
              ) : null}
              {queuedTurns.length ? (
                <span
                  className={styles.accessStatus}
                  data-access={queuedAccessState}
                  aria-label={t("composer.queuedTurnAccess", {
                    access: queuedAccessLabels.join(", "),
                  })}
                >
                  <strong>
                    {t("composer.queuedWithCount", { count: queuedTurns.length })}
                  </strong>
                  <i aria-hidden="true">·</i>
                  {queuedAccessLabels.join(" · ")}
                </span>
              ) : null}
            </div>
            <p className={styles.accessFrozenNote}>
              {t("composer.frozenAccessNote")}
            </p>
          </div>
        ) : null}
        <div className={styles.toolbar}>
          <div className={styles.context}>
            <button
              className={styles.attachButton}
              type="button"
              onClick={() => void pickContextFiles()}
              disabled={!editable || busy}
              aria-label={t("composer.attachFiles")}
              title={t("composer.attachFiles")}
            >
              <Paperclip size={13} />
            </button>
            <button
              className={styles.skillButton}
              type="button"
              onClick={() => setSkillPickerOpen((open) => !open)}
              disabled={
                !editable || busy || active || !skillCatalog.activeSkills.length
              }
              aria-expanded={skillPickerOpen}
              aria-label={t("composer.selectSkillsForTurn")}
              title={
                skillCatalog.activeSkills.length
                  ? t("composer.selectSkillsForTurn")
                  : t("composer.noSelectableSkills")
              }
            >
              <Sparkles size={13} />
              {selectedSkills.length ? <b>{selectedSkills.length}</b> : null}
            </button>
            <span title={thread?.workspacePath ?? project?.canonicalPath}>
              {thread?.mode === "paper" ? t("composer.paper2Code") : t("composer.local")}
            </span>
            <ModelPicker
              runtime={runtime}
              project={project}
              thread={thread}
              settings={settings}
              disabled={busy}
              onChange={onModelChange}
            />
            <TranscriptModePicker
              mode={transcriptMode}
              onChange={onTranscriptModeChange}
            />
            <label
              className={styles.selector}
              data-access={effectiveProductAccess ?? "inherit"}
              title={
                effectiveProductAccess === "full_access"
                  ? t("composer.newSubmissionsFullAccess")
                  : t("composer.toolAccessNewSubmissions")
              }
            >
              <ShieldCheck size={12} />
              <small className={styles.selectorCaption}>
                {t("composer.new")}
              </small>
              <select
                aria-label={t("composer.newSubmissionsAccess")}
                value={accessPresetOverride ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  void onAccessPresetChange(
                    value ? (value as ExecutionAccessPreset) : null,
                  );
                }}
                disabled={busy || !thread}
              >
                <option value="">
                  {t("composer.defaultWithLabel", { label: defaultAccessLabel })}
                </option>
                {ACCESS_PRESET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {active ? (
            <div className={styles.activeActions}>
              <button
                className={styles.steerButton}
                type="button"
                onClick={() => void submit()}
                disabled={!canExecute || busy || !prompt.trim()}
              >
                {t("composer.steer")}
              </button>
              <button
                className={styles.queueButton}
                type="button"
                onClick={() => void submitQueued()}
                disabled={!canExecute || busy || !prompt.trim()}
              >
                {t("composer.queueNext")}
              </button>
              <button
                className={styles.stopButton}
                type="button"
                onClick={onInterrupt}
                aria-label={t("composer.stopTurn")}
              >
                <Square size={13} fill="currentColor" />
                {t("composer.stop")}
              </button>
            </div>
          ) : (
            <button
              className={styles.sendButton}
              type="button"
              onClick={() => void submit()}
              disabled={!canExecute || busy || !prompt.trim()}
              aria-label={t("composer.runTurn")}
            >
              <ArrowUp size={17} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>
      <p className={styles.hint}>
        {commandError ??
          contextError ??
          deliveryNotice ??
          disabledReason ??
          t("composer.sensitiveToolsHint")}
        <span>
          {active ? t("composer.enterSteer") : t("composer.enterSend")} ·{" "}
          {t("composer.shiftEnterNewline")}
        </span>
      </p>
    </footer>
  );
}

function normalizedPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/+$/, "");
}

function isInsideWorkspace(path: string, workspace: string): boolean {
  const candidate = normalizedPath(path);
  const root = normalizedPath(workspace);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function fileName(path: string): string {
  return normalizedPath(path).split("/").at(-1) ?? path;
}

function withContextFiles(
  prompt: string,
  paths: string[],
  workspace: string | undefined,
  contextHeader: string,
): string {
  if (!paths.length) return prompt;
  const root = workspace ? normalizedPath(workspace) : "";
  const references = paths.map((path) => {
    const normalized = normalizedPath(path);
    return normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
  });
  return [
    prompt,
    "",
    contextHeader,
    ...references.map((path) => `- ${path}`),
  ].join("\n");
}
