import type { Item } from "../../generated/app-server";
import i18n from "../../i18n";

interface ItemPresentation {
  stage: string;
  label: string;
  body: string | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function presentItem(item: Item): ItemPresentation {
  const text = stringValue(item.payload.text);
  const result = stringValue(item.payload.resultPreview);
  switch (item.kind) {
    case "user_message":
      return {
        stage: i18n.t("thread.itemStage.intent"),
        label: i18n.t("thread.itemLabel.request"),
        body: text ?? item.summary,
      };
    case "assistant_message":
      return {
        stage: i18n.t("thread.itemStage.response"),
        label: i18n.t("thread.itemLabel.agent"),
        body: text ?? item.summary,
      };
    case "reasoning_summary":
      return {
        stage: i18n.t("thread.itemStage.reasoning"),
        label: i18n.t("thread.itemLabel.thinking"),
        body:
          stringValue(item.payload.summaryText) ??
          stringValue(item.payload.traceText) ??
          text ??
          result ??
          item.summary,
      };
    case "plan":
      return {
        stage: i18n.t("thread.itemStage.plan"),
        label: i18n.t("thread.itemLabel.executionPlan"),
        body: text ?? result ?? item.summary,
      };
    case "approval_request":
      return {
        stage: i18n.t("thread.itemStage.approval"),
        label: i18n.t("thread.itemLabel.permissionReview"),
        body: item.summary,
      };
    case "command_execution":
      return {
        stage: i18n.t("thread.itemStage.tool"),
        label: i18n.t("thread.itemLabel.command"),
        body: result ?? item.summary,
      };
    case "tool_call":
      return {
        stage: i18n.t("thread.itemStage.tool"),
        label: i18n.t("thread.itemLabel.toolCall"),
        body: result ?? item.summary,
      };
    case "file_change":
      return {
        stage: i18n.t("thread.itemStage.change"),
        label: i18n.t("thread.itemLabel.fileChange"),
        body: result ?? item.summary,
      };
    case "diff":
      return {
        stage: i18n.t("thread.itemStage.change"),
        label: i18n.t("thread.itemLabel.diff"),
        body: text ?? item.summary,
      };
    case "test_result":
      return {
        stage: i18n.t("thread.itemStage.verify"),
        label: i18n.t("thread.itemLabel.testResult"),
        body: result ?? item.summary,
      };
    case "artifact":
      return {
        stage: i18n.t("thread.itemStage.artifact"),
        label: i18n.t("thread.itemLabel.artifact"),
        body: item.summary,
      };
    case "workflow_stage":
      return {
        stage: i18n.t("thread.itemStage.workflow"),
        label: i18n.t("thread.itemLabel.workflowStage"),
        body: item.summary,
      };
    case "error":
      return {
        stage: i18n.t("thread.itemStage.error"),
        label: i18n.t("thread.itemLabel.executionError"),
        body: text ?? item.summary,
      };
    case "completion":
      return {
        stage: i18n.t("thread.itemStage.complete"),
        label: i18n.t("thread.itemLabel.turnComplete"),
        body: item.summary,
      };
  }
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}
