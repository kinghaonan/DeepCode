import { Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  transcriptModes,
  type TranscriptMode,
} from "../thread/transcriptMode";
import styles from "./TranscriptModePicker.module.css";

interface TranscriptModePickerProps {
  mode: TranscriptMode;
  onChange(mode: TranscriptMode): void;
}

export function TranscriptModePicker({
  mode,
  onChange,
}: TranscriptModePickerProps) {
  const { t } = useTranslation();
  return (
    <label
      className={styles.picker}
      title={t("composer.transcriptDetailTitle")}
    >
      <Rows3 size={12} aria-hidden="true" />
      <select
        aria-label={t("composer.transcriptDetail")}
        value={mode}
        onChange={(event) => onChange(event.target.value as TranscriptMode)}
      >
        {transcriptModes.map((value) => (
          <option key={value} value={value}>
            {t(`composer.mode.${value}`)}
          </option>
        ))}
      </select>
    </label>
  );
}
