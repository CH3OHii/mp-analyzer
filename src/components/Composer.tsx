import { X } from "lucide-react";
import { useRef, useState } from "react";
import { sendOrQueue } from "../agent/dispatch";
import { useT } from "../i18n";
import { removeQueuedAt, stopTurn, useChat } from "../store/chatStore";

export default function Composer() {
  const t = useT();
  const chatState = useChat();
  const [text, setText] = useState("");
  // IME guard: confirming a Chinese composition with Enter must NOT send.
  const composing = useRef(false);

  function send() {
    const msg = text.trim();
    if (!msg) return;
    setText("");
    sendOrQueue(msg); // mid-turn sends queue; idle sends run immediately
  }

  return (
    <div className="composer-wrap">
      {chatState.queued.length > 0 && (
        <div className="queue-row">
          {chatState.queued.map((q, i) => (
            <span className="queued-chip" key={`${i}-${q.slice(0, 8)}`} title={t.queuedHint}>
              <span className="chip-text">{q}</span>
              <button className="chip-x" onClick={() => removeQueuedAt(i)} title={t.removeQueued}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="composer">
        <textarea
          value={text}
          placeholder={t.composerPlaceholder}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        {chatState.streaming ? (
          <button className="btn danger" onClick={stopTurn}>
            {t.stop}
          </button>
        ) : (
          <button className="btn primary" onClick={send} disabled={!text.trim()}>
            {t.send}
          </button>
        )}
      </div>
    </div>
  );
}
