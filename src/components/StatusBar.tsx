import { useState } from "react";
import { estimateHistoryTokens } from "../agent/history";
import { revertAll, useSnapshots } from "../excel/snapshot";
import { useT } from "../i18n";
import { getPreset } from "../llm/providers";
import { addError, llmHistory, markStepsReverted, useChat } from "../store/chatStore";
import { useSettings } from "../store/settings";

export default function StatusBar() {
  const t = useT();
  const s = useSettings();
  const chatState = useChat();
  const snaps = useSnapshots();
  const [busy, setBusy] = useState(false);

  const preset = getPreset(s.llm.providerId);
  const cost = preset.price
    ? (chatState.usage.prompt * preset.price.input + chatState.usage.completion * preset.price.output) / 1e6
    : null;
  const ctxTokens = estimateHistoryTokens(llmHistory);

  async function onRevertAll() {
    setBusy(true);
    try {
      const steps = await revertAll();
      markStepsReverted(steps.map((x) => x.id));
    } catch (e) {
      addError(`${t.revertFailed}: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(false);
  }

  return (
    <div className="statusbar">
      <span>
        {preset.label} · {s.llm.model}
      </span>
      <span className="spacer" />
      <span>
        {t.ctx} ~{(ctxTokens / 1000).toFixed(1)}k
      </span>
      <span>
        {chatState.usage.prompt + chatState.usage.completion} tok
        {cost != null && cost > 0 ? ` · $${cost.toFixed(4)} ${t.estNote}` : ""}
      </span>
      {snaps.steps.length > 0 && (
        <button className="btn small" disabled={busy} onClick={onRevertAll}>
          {t.revertSteps(snaps.steps.length)}
        </button>
      )}
    </div>
  );
}
