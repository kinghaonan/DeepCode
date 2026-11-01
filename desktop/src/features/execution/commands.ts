import type { ExecutionAccessPreset } from "../../generated/app-server";
import i18n from "../../i18n";

export type ComposerCommand =
  | { type: "new" }
  | { type: "paper" }
  | { type: "review" }
  | { type: "fork" }
  | { type: "rename"; title: string }
  | { type: "model"; model: string | null }
  | { type: "permission"; accessPreset: ExecutionAccessPreset | null };

export interface CommandDefinition {
  name: string;
  usage: string;
  description: string;
}

interface CommandSpec {
  name: string;
  usage: string;
  descriptionKey: string;
}

const commandSpecs: CommandSpec[] = [
  {
    name: "new",
    usage: "/new",
    descriptionKey: "composer.commands.newDescription",
  },
  {
    name: "paper",
    usage: "/paper",
    descriptionKey: "composer.commands.paperDescription",
  },
  {
    name: "review",
    usage: "/review",
    descriptionKey: "composer.commands.reviewDescription",
  },
  {
    name: "fork",
    usage: "/fork",
    descriptionKey: "composer.commands.forkDescription",
  },
  {
    name: "rename",
    usage: "/rename ",
    descriptionKey: "composer.commands.renameDescription",
  },
  {
    name: "model",
    usage: "/model ",
    descriptionKey: "composer.commands.modelDescription",
  },
  {
    name: "permissions",
    usage: "/permissions ",
    descriptionKey: "composer.commands.permissionsDescription",
  },
];

function buildCommandDefinitions(): CommandDefinition[] {
  return commandSpecs.map((spec) => ({
    name: spec.name,
    usage: spec.usage,
    description: i18n.t(spec.descriptionKey),
  }));
}

export type CommandParseResult =
  | { ok: true; command: ComposerCommand }
  | { ok: false; message: string };

function requireNoArgument(name: string, argument: string): CommandParseResult | null {
  return argument
    ? {
        ok: false,
        message: i18n.t("composer.commands.noArgument", { name }),
      }
    : null;
}

export function parseComposerCommand(value: string): CommandParseResult | null {
  const input = value.trim();
  if (!input.startsWith("/")) return null;
  const separator = input.search(/\s/);
  const name = (
    separator === -1 ? input.slice(1) : input.slice(1, separator)
  ).toLocaleLowerCase();
  const argument = separator === -1 ? "" : input.slice(separator).trim();

  switch (name) {
    case "new":
    case "paper":
    case "review":
    case "fork": {
      const error = requireNoArgument(name, argument);
      return error ?? { ok: true, command: { type: name } };
    }
    case "rename":
      return argument
        ? { ok: true, command: { type: "rename", title: argument } }
        : { ok: false, message: i18n.t("composer.commands.usageRename") };
    case "model":
      return argument
        ? {
            ok: true,
            command: {
              type: "model",
              model: argument === "default" ? null : argument,
            },
          }
        : { ok: false, message: i18n.t("composer.commands.usageModel") };
    case "permission":
    case "permissions": {
      const aliases: Record<string, ExecutionAccessPreset | null> = {
        ask: "ask",
        approval: "ask",
        "read-only": "read_only",
        read_only: "read_only",
        plan: "read_only",
        "full-access": "full_access",
        full_access: "full_access",
        inherit: null,
        default: null,
      };
      const key = argument.toLocaleLowerCase();
      return Object.hasOwn(aliases, key)
        ? {
            ok: true,
            command: { type: "permission", accessPreset: aliases[key] ?? null },
          }
        : {
            ok: false,
            message: i18n.t("composer.commands.usagePermissions"),
          };
    }
    default:
      return {
        ok: false,
        message: i18n.t("composer.commands.unknown", { name: name || "…" }),
      };
  }
}

export function matchingCommands(value: string): CommandDefinition[] {
  const input = value.trimStart();
  if (!input.startsWith("/") || input.includes("\n")) return [];
  const query = input.slice(1).split(/\s/, 1)[0].toLocaleLowerCase();
  return buildCommandDefinitions().filter((definition) =>
    definition.name.startsWith(query),
  );
}
