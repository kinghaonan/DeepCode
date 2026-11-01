import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  MinusCircle,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import type {
  ProviderTestResult,
  ProviderVerificationStage,
} from "../../generated/app-server";
import i18n from "../../i18n";
import styles from "./ConnectionVerification.module.css";

interface ConnectionVerificationProps {
  result: ProviderTestResult;
  compact?: boolean;
}

const STAGE_LABEL_KEYS: Record<ProviderVerificationStage["id"], string> = {
  credential: "settings.stage.credential",
  catalog: "settings.stage.catalog",
  model: "settings.stage.model",
};

export function ConnectionVerification({
  result,
  compact = false,
}: ConnectionVerificationProps) {
  const { t } = useTranslation();
  return (
    <section
      className={styles.verification}
      data-status={result.status}
      data-compact={compact}
      aria-label={t("settings.connectionStatusAria", {
        status: statusLabel(result.status),
      })}
    >
      <header>
        <strong>{statusLabel(result.status)}</strong>
        <span>{t("settings.latencyTotal", { latency: result.latencyMs })}</span>
      </header>
      <div className={styles.stages}>
        {result.stages.map((stage) => (
          <div key={stage.id} data-status={stage.status}>
            <StageIcon stage={stage} />
            <span>
              <strong>{t(STAGE_LABEL_KEYS[stage.id])}</strong>
              <small>{stage.detail}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function StageIcon({ stage }: { stage: ProviderVerificationStage }) {
  if (stage.status === "passed") return <CheckCircle2 size={14} />;
  if (stage.status === "failed") return <AlertCircle size={14} />;
  if (stage.status === "skipped") return <MinusCircle size={14} />;
  return <CircleDashed size={14} />;
}

function statusLabel(status: ProviderTestResult["status"]): string {
  switch (status) {
    case "ready":
      return i18n.t("settings.verifyReady");
    case "connected":
      return i18n.t("settings.verifyConnected");
    case "limited":
      return i18n.t("settings.verifyLimited");
    default:
      return i18n.t("settings.verifyError");
  }
}
