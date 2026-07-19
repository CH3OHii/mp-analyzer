import { en, type Dict } from "./en";
import { zh } from "./zh";
import { useSettings } from "../store/settings";

const dicts: Record<"en" | "zh", Dict> = { en, zh };

export function dict(lang: "en" | "zh"): Dict {
  return dicts[lang] ?? en;
}

/** React hook — returns the active dictionary, re-rendering on language change. */
export function useT(): Dict {
  const s = useSettings();
  return dict(s.language);
}
