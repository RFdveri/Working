import type { AgentLogEntry } from "@ai-door-assistant/shared";

const ANALYSIS_AGENTS = new Set(["vision", "document", "voice"]);

export function AnalysisHistory(props: { logs: AgentLogEntry[] }) {
  const analysisLogs = props.logs.filter((l) => ANALYSIS_AGENTS.has(l.agent));
  return (
    <section className="panel">
      <h2>История анализа</h2>
      {analysisLogs.length === 0 ? (
        <p className="empty">Файлы и голосовые ещё не анализировались</p>
      ) : (
        <ul className="log-list">
          {analysisLogs
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id}>
                <span className="log-agent">{entry.agent}</span>
                <span className="log-action">{entry.action}</span>
                {entry.detail && <span className="log-detail">{entry.detail}</span>}
              </li>
            ))}
        </ul>
      )}
    </section>
  );
}
