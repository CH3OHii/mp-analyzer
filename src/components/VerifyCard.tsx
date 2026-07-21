import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useT } from "../i18n";
import type { VerifyIssue } from "../store/chatStore";

/** Turn-end verification result: a green pass line, or the reviewer's issues. */
export default function VerifyCard({ verdict, issues }: { verdict: "pass" | "issues"; issues: VerifyIssue[] }) {
  const t = useT();
  if (verdict === "pass") {
    return (
      <div className="verifycard pass">
        <CheckCircle2 size={14} /> {t.verifyPass}
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
