import { useState } from "react";
import type { ManagerTask } from "@ai-door-assistant/shared";

const TASK_TYPE_LABELS: Record<ManagerTask["type"], string> = {
  "call-back": "Перезвонить",
  "prepare-quote": "Подготовить КП",
  "check-availability": "Уточнить наличие",
  "schedule-measurement": "Назначить замер",
  "negotiate-discount": "Согласовать скидку",
  other: "Другое",
};

export function TasksPanel(props: {
  tasks: ManagerTask[];
  onCreate: (type: ManagerTask["type"], text: string) => void;
}) {
  const [type, setType] = useState<ManagerTask["type"]>("call-back");
  const [text, setText] = useState("");

  return (
    <section className="panel">
      <h2>Задачи менеджерам</h2>
      <div className="task-form">
        <select value={type} onChange={(e) => setType(e.target.value as ManagerTask["type"])}>
          {(Object.keys(TASK_TYPE_LABELS) as ManagerTask["type"][]).map((t) => (
            <option key={t} value={t}>
              {TASK_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Комментарий к задаче"
        />
        <button
          type="button"
          disabled={!text.trim()}
          onClick={() => {
            props.onCreate(type, text);
            setText("");
          }}
        >
          Создать
        </button>
      </div>
      {props.tasks.length === 0 ? (
        <p className="empty">Задач пока нет</p>
      ) : (
        <ul className="task-list">
          {props.tasks.map((task) => (
            <li key={task.id}>
              <strong>{TASK_TYPE_LABELS[task.type]}</strong>: {task.text}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
