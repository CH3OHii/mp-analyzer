import {
  ArrowUpDown,
  ChartColumn,
  Crosshair,
  Eye,
  Globe,
  Layers,
  Map,
  Paintbrush,
  Pencil,
  Search,
  Sigma,
  Thermometer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { revertTop, useSnapshots } from "../excel/snapshot";
import { useT } from "../i18n";
import type { ToolCardModel } from "../store/chatStore";
import { addError, markStepsReverted } from "../store/chatStore";
import PendingChange from "./PendingChange";

const ICON: Record<string, LucideIcon> = {
  get_workbook_overview: Map,
  read_range: Eye,
  get_selection: Crosshair,
  find: Search,
  write_range: Pencil,
  set_formulas: Sigma,
  format_range: Paintbrush,
  conditional_formatting: Thermometer,
  create_chart: ChartColumn,
  manage_sheet: Layers,
  insert_delete: ArrowUpDown,
  $web_search: Globe,
};

export default function ToolCard({ card, isPendingActive }: { card: ToolCardModel; isPendingActive: boolean }) {
  const t = useT();
  const snaps = useSnapshots();
  const [open, setOpen] = useState(false);
  const [reverting, setReverting] = useState(false);

  const Icon = ICON[card.name] ?? Wrench;
  const isTop = card.stepId != null && snaps.steps[snaps.steps.length - 1]?.id === card.stepId;
  const statusLabel: Record<string, string> = {
    pending: t.statusPending,
    running: t.statusRunning,
    applied: t.statusApplied,
    done: t.statusDone,
    rejected: t.statusRejected,
    error: t.statusError,
    reverted: t.statusReverted,
  };

  async function onRevert() {
    setReverting(true);
    try {
      const step = await revertTop();
      markStepsReverted([step.id]);
    } catch (e) {
      addError(`${t.revertFailed}: ${e instanceof Error ? e.message : String(e)}`);
    }
    setReverting(false);
  }

  const argsPretty = card.args ? JSON.stringify(card.args, null, 1) : card.argsRaw;

  return (
    <div className="toolcard">
      <div className="head" onClick={() => setOpen((v) => !v)}>
        <Icon size={14} className="ticon" />
        <span className="name">{card.name === "$web_search" ? t.webSearchTool : card.name}</span>
        <span className="target">
          {card.target ?? ""}
          {card.preview?.cells ? ` · ${card.preview.cells} ${t.cells}` : ""}
        </span>
        <span className={`status ${card.status}`}>{statusLabel[card.status] ?? card.status}</span>
      </div>

      {/* Pending: the card shows CONTEXT (what will change); the decision
          buttons live only in the pinned PendingBar above the composer. */}
      {card.status === "pending" && isPendingActive && (
        <div className="detail">
          <div className="hint">{t.pendingHint}</div>
          {card.mutating === "hard" && <div className="error-banner">{t.hardOpWarning}</div>}
          {card.preview && <PendingChange preview={card.preview} />}
        </div>
      )}

      {open && card.status !== "pending" && (
        <div className="detail">
          {argsPretty && argsPretty !== "{}" && <pre>{argsPretty.slice(0, 2000)}</pre>}
          {card.resultSummary && <pre>{card.resultSummary.slice(0, 2000)}</pre>}
          {card.error && <div className="error-banner">{card.error}</div>}
        </div>
      )}

      {card.status === "applied" && isTop && (
        <div className="actions">
          <button className="btn small" disabled={reverting} onClick={onRevert}>
            {t.revert}
          </button>
        </div>
      )}
    </div>
  );
}
