import type { AssistantMode } from "@ai-door-assistant/shared";

const MODE_LABELS: Record<AssistantMode, string> = {
  auto: "Автоматический",
  "semi-auto": "Полуавтоматический",
  "hints-only": "Только подсказки",
  off: "Выключен",
};

export function StatusPanel(props: {
  mode: AssistantMode;
  managerActive: boolean;
  onModeChange: (mode: AssistantMode) => void;
}) {
  return (
    <section className="panel status-panel">
      <h2>Статус AI</h2>
      <div className={`status-badge ${props.managerActive ? "status-badge--handoff" : "status-badge--active"}`}>
        {props.managerActive ? "Менеджер подключён — AI на паузе" : "AI ведёт диалог"}
      </div>
      <label className="mode-select">
        Режим:
        <select
          value={props.mode}
          onChange={(e) => props.onModeChange(e.target.value as AssistantMode)}
        >
          {(Object.keys(MODE_LABELS) as AssistantMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode]}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
