import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { createEmptyMemory, type AgentContext, type AssistantMode, type Message } from "@ai-door-assistant/shared";
import type { AppContainer } from "../../core/AppContainer.js";
import type { Conversation } from "../../core/conversation/ConversationManager.js";

async function buildContext(app: AppContainer, conversation: Conversation): Promise<AgentContext> {
  return {
    conversationId: conversation.id,
    dealId: conversation.dealId,
    contactId: conversation.contactId,
    mode: conversation.mode,
    managerActive: conversation.managerActive,
    memory: conversation.contactId ? await app.memory.get(conversation.contactId) : createEmptyMemory(),
    history: conversation.messages,
    focusProduct: conversation.focusProduct,
  };
}

const createConversationSchema = z.object({
  dealId: z.string().optional(),
  contactId: z.string().optional(),
});

const postMessageSchema = z.object({
  role: z.enum(["customer", "manager"]),
  text: z.string(),
  attachments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["image", "pdf", "docx", "xlsx", "dwg", "audio", "other"]),
        url: z.string(),
        fileName: z.string(),
      })
    )
    .optional(),
});

const setModeSchema = z.object({
  mode: z.enum(["auto", "semi-auto", "hints-only", "off"]),
});

const createTaskSchema = z.object({
  type: z.enum([
    "call-back",
    "prepare-quote",
    "check-availability",
    "schedule-measurement",
    "negotiate-discount",
    "other",
  ]),
  text: z.string(),
  dueAt: z.string().optional(),
});

const calculatePriceSchema = z.object({
  sku: z.string(),
  customSize: z.object({ widthMm: z.number(), heightMm: z.number() }).optional(),
  services: z.array(z.string()).optional(),
  components: z
    .array(
      z.object({
        sku: z.string(),
        quantity: z.number().positive(),
        role: z.string().optional(),
      })
    )
    .optional(),
  kit: z
    .object({
      frameQuantity: z.number().positive(),
      casingQuantity: z.number().positive(),
    })
    .optional(),
});

export function createWidgetRouter(app: AppContainer): Router {
  const router = Router();

  router.post("/conversations", async (req, res) => {
    const body = createConversationSchema.parse(req.body);
    const conversation = app.conversations.create(body);
    res.status(201).json(conversation);
  });

  router.get("/conversations/:id", (req, res) => {
    const conversation = app.conversations.get(req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(conversation);
  });

  router.patch("/conversations/:id/mode", (req, res) => {
    const { mode } = setModeSchema.parse(req.body) as { mode: AssistantMode };
    const conversation = app.conversations.setMode(req.params.id, mode);
    res.json(conversation);
  });

  router.post("/conversations/:id/messages", async (req, res, next) => {
    try {
      const body = postMessageSchema.parse(req.body);
      const conversationId = req.params.id;
      let conversation = app.conversations.requireConversation(conversationId);

      const message: Message = {
        id: randomUUID(),
        role: body.role,
        text: body.text,
        attachments: body.attachments,
        timestamp: new Date().toISOString(),
      };
      conversation = app.conversations.appendMessage(conversationId, message);

      if (body.role === "manager") {
        conversation = app.conversations.markManagerActive(conversationId);
        res.status(201).json({ conversation });
        return;
      }

      const context = await buildContext(app, conversation);
      const result = await app.directorAgent.handle(context, { message });
      conversation = app.conversations.appendLogs(conversationId, result.logs);

      if (result.payload?.focusProduct) {
        conversation = app.conversations.setFocusProduct(conversationId, result.payload.focusProduct);
      }

      if (result.reply) {
        conversation = app.conversations.appendMessage(conversationId, {
          id: randomUUID(),
          role: "assistant",
          text: result.reply,
          timestamp: new Date().toISOString(),
        });
      }

      res.status(201).json({ conversation, result });
    } catch (error) {
      next(error);
    }
  });

  router.post("/conversations/:id/tasks", async (req, res, next) => {
    try {
      const body = createTaskSchema.parse(req.body);
      const conversation = app.conversations.requireConversation(req.params.id);
      const context = await buildContext(app, conversation);
      const result = await app.taskAgent.handle(context, body);
      app.conversations.appendLogs(conversation.id, result.logs);
      res.status(201).json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  router.post("/conversations/:id/summary", async (req, res, next) => {
    try {
      const conversation = app.conversations.requireConversation(req.params.id);
      const context = await buildContext(app, conversation);
      const result = await app.summaryAgent.handle(context, {});
      app.conversations.appendLogs(conversation.id, result.logs);
      res.status(201).json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  router.post("/conversations/:id/price", async (req, res, next) => {
    try {
      const body = calculatePriceSchema.parse(req.body);
      const conversation = app.conversations.requireConversation(req.params.id);
      const context = await buildContext(app, conversation);

      const product = await app.productAgent.handle(context, { sku: body.sku });
      if (!product.payload) {
        app.conversations.appendLogs(conversation.id, product.logs);
        res.status(404).json({ error: "product not found", clarifyingQuestions: product.clarifyingQuestions });
        return;
      }

      const result = await app.priceAgent.handle(context, {
        product: product.payload,
        customSize: body.customSize,
        services: body.services,
        components: body.components,
        kit: body.kit,
      });
      app.conversations.appendLogs(conversation.id, [...product.logs, ...result.logs]);
      res.status(201).json(result.payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
