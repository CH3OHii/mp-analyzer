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

// TEMP DOM diagnostic: reports what the chat's children actually are (tag,
// class, height, text head) + scroll metrics to the local server log, so the
// "renders as a thin line" bug can be identified from inside Excel. Remove after.
let domDiagTimer: number | undefined;
function beaconDom(el: HTMLDivElement) {
  clearTimeout(domDiagTimer);
  domDiagTimer = window.setTimeout(() => {
    const kids = [...el.children].slice(-14).map((k) => {
      const h = Math.round(k.getBoundingClientRect().height);
      const cls = String((k as HTMLElement).className || "").split(" ").slice(0, 2).join("_");
      const txt = (k.textContent || "").slice(0, 8).replace(/[^\w一-鿿]/g, "");
      return `${k.tagName}.${cls}.h${h}.${txt}`;
    });
    const head = `sc${Math.round(el.scrollTop)}of${el.scrollHeight}win${el.clientHeight}`;
    fetch("/__diag/dom/" + encodeURIComponent([head, ...kids].join("~"))).catch(() => {});
  }, 800);
}

export default function Chat() {
  const t = useT();
  const state = useChat();
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);

  const onScroll = () => {
    const el = ref.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Follow new content only when the user is already at the bottom, so scrolling
  // up to read isn't yanked back down by every streamed token.
  useEffect(() => {
    const el = ref.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
    if (el) beaconDom(el);
  }, [state.items]);

  // A pending approval must show its Apply/Reject buttons — always reveal it.
  useEffect(() => {
    const el = ref.current;
    if (el && state.pendingCardId != null) {
      el.scrollTop = el.scrollHeight;
      nearBottom.current = true;
    }
  }, [state.pendingCardId]);

  return (
    <div className="chat" ref={ref} onScroll={onScroll}>
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
