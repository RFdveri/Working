import { useEffect, useState } from "react";
import type { AssistantMode, ChatTurnResult, ManagerTask, Product } from "@ai-door-assistant/shared";
import {
  type ConversationDto,
  createConversation,
  createManagerTask,
  sendMessage,
  setConversationMode,
} from "./api/client";
import { ActionLog } from "./components/ActionLog";
import { AnalysisHistory } from "./components/AnalysisHistory";
import { Calculations } from "./components/Calculations";
import { FoundProducts } from "./components/FoundProducts";
import { Recommendations } from "./components/Recommendations";
import { StatusPanel } from "./components/StatusPanel";
import { TasksPanel } from "./components/TasksPanel";

export function App() {
  const [conversation, setConversation] = useState<ConversationDto | null>(null);
  const [draft, setDraft] = useState("");
  const [foundProducts, setFoundProducts] = useState<Product[]>([]);
  const [priceCalculation, setPriceCalculation] = useState<ChatTurnResult["priceCalculation"]>();
  const [tasks, setTasks] = useState<ManagerTask[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    createConversation({}).then(setConversation).catch((e) => setError(String(e)));
  }, []);

  if (!conversation) {
    return <div className="widget-loading">{error ?? "Загрузка ассистента..."}</div>;
  }

  async function handleSend() {
    if (!conversation || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { conversation: updated, result } = await sendMessage(conversation.id, draft);
      setConversation(updated);
      setDraft("");
      if (result?.payload) {
        setFoundProducts(result.payload.foundProducts ?? []);
        setPriceCalculation(result.payload.priceCalculation);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function handleModeChange(mode: AssistantMode) {
    if (!conversation) return;
    const updated = await setConversationMode(conversation.id, mode);
    setConversation(updated);
  }

  async function handleCreateTask(type: ManagerTask["type"], text: string) {
    if (!conversation) return;
    const task = await createManagerTask(conversation.id, { type, text });
    setTasks((prev) => [...prev, task]);
  }

  return (
    <div className="widget">
      <div className="widget-chat">
        <h2>Диалог</h2>
        <div className="chat-history">
          {conversation.messages.map((m) => (
            <div key={m.id} className={`chat-message chat-message--${m.role}`}>
              <span className="chat-role">{m.role}</span>
              <span>{m.text}</span>
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Сообщение клиента..."
            disabled={sending}
          />
          <button type="button" onClick={handleSend} disabled={sending || !draft.trim()}>
            Отправить
          </button>
        </div>
        {error && <p className="widget-error">{error}</p>}
      </div>

      <div className="widget-panels">
        <StatusPanel
          mode={conversation.mode}
          managerActive={conversation.managerActive}
          onModeChange={handleModeChange}
        />
        <ActionLog logs={conversation.logs} title="Журнал действий" />
        <AnalysisHistory logs={conversation.logs} />
        <FoundProducts products={foundProducts} />
        <Calculations calculation={priceCalculation} />
        <Recommendations messages={conversation.messages} />
        <TasksPanel tasks={tasks} onCreate={handleCreateTask} />
      </div>
    </div>
  );
}
