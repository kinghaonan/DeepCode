import { Check, Copy } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { useSystemDarkMode } from "../../app/useSystemDarkMode";
import styles from "./MarkdownContent.module.css";

const STREAM_THROTTLE_MS = 120;

interface MarkdownContentProps {
  children: string;
  compact?: boolean;
  streaming?: boolean;
}

interface CodeBlockProps {
  code: string;
  language: string;
}

const CodeBlock = memo(function CodeBlock({ code, language }: CodeBlockProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const darkMode = useSystemDarkMode();

  useEffect(() => {
    if (!copied) return;
    const timeout = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  const copy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };

  return (
    <figure className={styles.codeBlock}>
      <figcaption>
        <span>{language || t("common.text")}</span>
        <button type="button" onClick={() => void copy()} aria-label={t("common.copyCode")}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? t("common.copied") : t("common.copy")}
        </button>
      </figcaption>
      <Highlight
        theme={darkMode ? themes.vsDark : themes.github}
        code={code}
        language={language || "text"}
      >
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre>
            {tokens.map((line, lineIndex) => (
              <span {...getLineProps({ line })} key={lineIndex}>
                {line.map((token, tokenIndex) => (
                  <span {...getTokenProps({ token })} key={tokenIndex} />
                ))}
                {"\n"}
              </span>
            ))}
          </pre>
        )}
      </Highlight>
    </figure>
  );
});

function ExternalLink({
  href,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
    </a>
  );
}

export function MarkdownContent({
  children,
  compact = false,
  streaming = false,
}: MarkdownContentProps) {
  // Throttled snapshot of `children`. Outside streaming mode we render
  // `children` directly so the final text always appears immediately.
  const [rendered, setRendered] = useState(children);
  // Latest text, read by the throttle interval without triggering a
  // re-render per delta. Synced in an effect (not during render) so the
  // interval always observes the most recently committed text.
  const latestRef = useRef(children);

  useEffect(() => {
    latestRef.current = children;
  });

  useEffect(() => {
    if (!streaming) return;

    // In streaming mode, flush the accumulated text at most every
    // STREAM_THROTTLE_MS rather than re-parsing + re-highlighting the whole
    // document on every delta.
    const interval = window.setInterval(() => {
      setRendered(latestRef.current);
    }, STREAM_THROTTLE_MS);

    return () => {
      window.clearInterval(interval);
      // Unmount mid-stream (or the stream flipping off): flush any text that
      // accumulated after the last tick so no delta is ever dropped.
      setRendered(latestRef.current);
    };
  }, [streaming]);

  const markdown = streaming ? rendered : children;

  // Stable component references: react-markdown remounts a render function
  // when its identity changes, which would defeat the CodeBlock memo below.
  const components = useMemo<Components>(
    () => ({
      a: ({ node, ...props }) => {
        void node;
        return <ExternalLink {...props} />;
      },
      pre: ({ children: preChildren }) => <>{preChildren}</>,
      code: ({ node, className, children: codeChildren, ...props }) => {
        void node;
        const code = String(codeChildren).replace(/\n$/, "");
        const language = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? "";
        const block = Boolean(language) || String(codeChildren).includes("\n");
        if (block) {
          return <CodeBlock code={code} language={language} />;
        }
        return (
          <code {...props} className={className}>
            {codeChildren as ReactNode}
          </code>
        );
      },
    }),
    [],
  );

  return (
    <div className={styles.markdown} data-compact={compact}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={components}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
