import type {
  ExecutionAccessPreset,
  ExecutionSecurityProfile,
  SettingsSnapshot,
  Turn,
} from "../generated/app-server";
import i18n from "../i18n";

export interface AccessPresetOption {
  value: ExecutionAccessPreset;
  label: string;
}

/** One product vocabulary shared by every Desktop access selector. */
export const ACCESS_PRESET_OPTIONS = [
  { value: "ask", label: i18n.t("access.ask") },
  { value: "read_only", label: i18n.t("access.readOnly") },
  { value: "full_access", label: i18n.t("access.fullAccess") },
] as const satisfies readonly AccessPresetOption[];

/** Parse only the product-level presets; legacy permission modes stay distinct. */
export function productAccessPreset(
  value: unknown,
): ExecutionAccessPreset | null {
  return value === "ask" || value === "read_only" || value === "full_access"
    ? value
    : null;
}

export function settingsProductAccessPreset(
  settings: SettingsSnapshot | null,
): ExecutionAccessPreset | null {
  return productAccessPreset(
    settings?.resolvedDefaultSecurityProfile.accessPreset,
  );
}

export function hasLegacyPermissionDefault(
  settings: SettingsSnapshot | null,
): boolean {
  return (
    settings !== null &&
    settings.resolvedDefaultSecurityProfile.accessPreset === null
  );
}

export function accessPresetLabel(preset: ExecutionAccessPreset): string {
  const option = ACCESS_PRESET_OPTIONS.find(
    (candidate) => candidate.value === preset,
  );
  if (!option) throw new Error(`Unsupported access preset: ${preset}`);
  return option.label;
}

export function executionSecurityLabel(
  profile: ExecutionSecurityProfile,
): string {
  if (profile.accessPreset !== null) {
    return accessPresetLabel(profile.accessPreset);
  }
  if (profile.permissionMode === "plan") return i18n.t("access.legacyReadOnly");
  if (profile.permissionMode === "full_auto") {
    return profile.commandSandbox
      ? i18n.t("access.legacyAutoSandboxed")
      : i18n.t("access.legacyAutoSandboxOff");
  }
  return profile.commandSandbox
    ? i18n.t("access.legacyAskSandboxed")
    : i18n.t("access.legacyAskSandboxOff");
}

/** Describe the authoritative resolved default without upgrading legacy modes. */
export function settingsDefaultAccessLabel(
  settings: SettingsSnapshot | null,
): string {
  if (!settings) return i18n.t("access.loading");
  return executionSecurityLabel(settings.resolvedDefaultSecurityProfile);
}

/** Present the immutable access snapshot captured when a Turn was admitted. */
export function turnExecutionAccessLabel(turn: Turn): string {
  if (turn.executionSecurityProfile) {
    return executionSecurityLabel(turn.executionSecurityProfile);
  }
  if (turn.executionPermissionMode === "plan") return i18n.t("access.legacyReadOnly");
  if (turn.executionPermissionMode === "full_auto") return i18n.t("access.legacyAuto");
  if (turn.executionPermissionMode === "default") return i18n.t("access.legacyAsk");
  return i18n.t("access.unavailable");
}

export type TurnExecutionAccessState =
  | ExecutionAccessPreset
  | "legacy"
  | "unknown";

export function turnExecutionAccessState(
  turn: Turn,
): TurnExecutionAccessState {
  const preset = productAccessPreset(
    turn.executionSecurityProfile?.accessPreset,
  );
  if (preset !== null) return preset;
  if (turn.executionSecurityProfile || turn.executionPermissionMode) {
    return "legacy";
  }
  return "unknown";
}
