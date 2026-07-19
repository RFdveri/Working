import type { AgentLogEntry } from "@ai-door-assistant/shared";

export function ActionLog(props: { logs: AgentLogEntry[]; title: string }) {
  return (
    <section className="panel">
      <h2>{props.title}</h2>
      {props.logs.length === 0 ? (
        <p className="empty">Пока нет записей</p>
      ) : (
        <ul className="log-list">
          {props.logs
            .slice()
            .reverse()
            .map((entry) => (
              <li key={entry.id} className={entry.clarificationNeeded ? "log-item--clarify" : ""}>
                <span className="log-time">{new Date(entry.timestamp).toLocaleTimeString()}</span>
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
