export default function App() {
  const inExcel = typeof Excel !== "undefined" && typeof Office !== "undefined" && !!Office.context;
  return (
    <div className="app">
      <div className="phase0">
        <h1>MP Analyzer</h1>
        <p>{inExcel ? "Task pane loaded inside Excel ✓" : "Running outside Excel (browser preview)"}</p>
      </div>
    </div>
  );
}
