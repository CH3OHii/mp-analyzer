import { useState } from "react";
import Chat from "./components/Chat";
import Composer from "./components/Composer";
import PendingBar from "./components/PendingBar";
import SettingsPanel from "./components/SettingsPanel";
import StatusBar from "./components/StatusBar";
import TopBar from "./components/TopBar";
import { apiSupported, hasExcel } from "./excel/env";
import { useT } from "./i18n";

export default function App() {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const inExcel = hasExcel();

  if (inExcel && !apiSupported()) {
    return (
      <div className="blocking">
        <h2>{t.unsupportedTitle}</h2>
        <p>{t.unsupportedBody}</p>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar onSettings={() => setSettingsOpen(true)} />
      {!inExcel && <div className="notice">{t.browserPreviewNote}</div>}
      <Chat />
      <PendingBar />
      <StatusBar />
      <Composer />
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
