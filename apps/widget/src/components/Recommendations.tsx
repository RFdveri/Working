import type { Message } from "@ai-door-assistant/shared";

export function Recommendations(props: { messages: Message[] }) {
  const assistantMessages = props.messages.filter((m) => m.role === "assistant");
  return (
    <section className="panel">
      <h2>Рекомендации</h2>
      {assistantMessages.length === 0 ? (
        <p className="empty">AI пока не давал рекомендаций</p>
      ) : (
        <ul className="recommendation-list">
          {assistantMessages.slice(-5).map((message) => (
            <li key={message.id}>{message.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
