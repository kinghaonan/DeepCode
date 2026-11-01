import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";

import { App } from "./App";
import i18n from "./i18n";
import "./styles/tokens.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("DeepCode desktop root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  </StrictMode>,
);
