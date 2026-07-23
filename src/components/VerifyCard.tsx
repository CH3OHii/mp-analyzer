import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useT } from "../i18n";
import type { VerifyIssue } from "../store/chatStore";

/** Turn-end verification result: a green pass line, or the reviewer's issues.
 *  `model` is set only when an independent reviewer model did the review. */
export default function VerifyCard({
  verdict,
  issues,
  model,
}: {
  verdict: "pass" | "issues";
  issues: VerifyIssue[];
  model?: string;
}) {
  const t = useT();
  const by = model ? <span className="hint"> · {t.verifiedBy(model)}</span> : null;
  if (verdict === "pass") {
    return (
      <div className="verifycard pass">
        <CheckCircle2 size={14} /> {t.verifyPass}
        {by}
      </div>
    );
  }
  const sevLabel: Record<VerifyIssue["severity"], string> = {
    high: t.sevHigh,
    medium: t.sevMedium,
    low: t.sevLow,
  };
  return (
    <div className="verifycard issues">
      <div className="head">
        <ShieldAlert size={14} /> {t.verifyIssuesTitle}
        {by}
      </div>
      <ul>
        {issues.map((i, k) => (
          <li key={k}>
            <span className={`sev ${i.severity}`}>{sevLabel[i.severity]}</span> {i.description}
            {i.cells && <span className="cells"> ({i.cells})</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
