import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useRef } from "react";
import { useT } from "../i18n";
import { useChat } from "../store/chatStore";
import ToolCard from "./ToolCard";

function Md({ text }: { text: string }) {
  const html = DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

export default function Chat() {
  const t = useT();
  const state = useChat();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  return (
    <div className="chat" ref={ref}>
      {state.items.map((it) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={it.id} className="msg user">
                {it.text}
              </div>
            );
          case "assistant":
            return (
              <div key={it.id} className="msg assistant">
                {it.reasoning && (
                  <details className="thinking">
                    <summary>{t.thinking}</summary>
                    <div className="body">{it.reasoning}</div>
                  </details>
                )}
                {it.text && <Md text={it.text} />}
                {it.streaming && !it.text && !it.reasoning && <div className="notice">…</div>}
              </div>
            );
          case "tool":
            return <ToolCard key={it.id} card={it.card} isPendingActive={state.pendingCardId === it.id} />;
          case "notice":
            return (
              <div key={it.id} className="notice">
                {it.text}
              </div>
            );
          case "error":
            return (
              <div key={it.id} className="error-banner">
                {it.text}
              </div>
            );
        }
      })}
    </div>
  );
}
