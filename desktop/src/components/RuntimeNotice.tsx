import { AlertTriangle, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { BridgeError, SidecarStatus } from "../rpc/contracts";
import styles from "./RuntimeNotice.module.css";

interface RuntimeNoticeProps {
  runtime: SidecarStatus;
  error: BridgeError | null;
  busy: boolean;
  reconnecting?: boolean;
  onRestart(): void;
  onDismissError(): void;
}

export function RuntimeNotice({
  runtime,
  error,
  busy,
  reconnecting = false,
  onRestart,
  onDismissError,
}: RuntimeNoticeProps) {
  const { t } = useTranslation();
  if (!error && runtime.phase !== "crashed" && runtime.phase !== "stopped") return null;
  const serviceOffline = runtime.phase === "crashed" || runtime.phase === "stopped";
  const message = error?.message ?? runtime.message ?? t("runtime.appServerUnavailable");
  return (
    <div
      className={styles.notice}
      role="alert"
      data-reconnecting={reconnecting || undefined}
    >
      <AlertTriangle size={17} aria-hidden="true" />
      <div className={styles.copy}>
        <strong>{error?.code ?? "APP_SERVER_OFFLINE"}</strong>
        <span>{reconnecting ? t("runtime.reconnecting") : message}</span>
      </div>
      <div className={styles.actions}>
        {error ? (
          <button
            className={styles.dismiss}
            type="button"
            onClick={onDismissError}
            aria-label={t("runtime.dismissError")}
          >
            <X size={14} />
          </button>
        ) : null}
        {serviceOffline ? (
          <button
            type="button"
            onClick={onRestart}
            disabled={busy || reconnecting}
          >
            <RotateCw size={13} />
            {t("runtime.restartService")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
