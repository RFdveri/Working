import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { createEmptyMemory, type AgentContext, type Message } from "@ai-door-assistant/shared";
import type { AppContainer } from "../../core/AppContainer.js";

const oauthCallbackSchema = z.object({ code: z.string() });

const digitalPipelineWebhookSchema = z.object({
  dealId: z.number(),
  contactId: z.number().optional(),
  text: z.string(),
});

/**
 * AmoCRM OAuth callback + Digital Pipeline inbound webhook. Register these URLs
 * in the AmoCRM integration settings (BASE_URL/api/amocrm/...).
 */
export function createAmoCrmRouter(app: AppContainer): Router {
  const router = Router();

  router.get("/oauth/callback", async (req, res, next) => {
    try {
      const { code } = oauthCallbackSchema.parse(req.query);
      if (!app.amoCrm) {
        res.status(503).json({ error: "AmoCRM integration is not configured" });
        return;
      }
      const tokens = await app.amoCrm.exchangeAuthorizationCode(code);
      res.json({ connected: true, expiresAt: tokens.expiresAt });
    } catch (error) {
      next(error);
    }
  });

  router.post("/webhook", async (req, res, next) => {
    try {
      const body = digitalPipelineWebhookSchema.parse(req.body);

      let conversation = app.conversations.findOrCreateByDealId({
        dealId: String(body.dealId),
        contactId: body.contactId ? String(body.contactId) : undefined,
      });

      const message: Message = {
        id: randomUUID(),
        role: "customer",
        text: body.text,
        timestamp: new Date().toISOString(),
      };
      conversation = app.conversations.appendMessage(conversation.id, message);

      const context: AgentContext = {
        conversationId: conversation.id,
        dealId: conversation.dealId,
        contactId: conversation.contactId,
        mode: conversation.mode,
        managerActive: conversation.managerActive,
        memory: conversation.contactId ? await app.memory.get(conversation.contactId) : createEmptyMemory(),
        history: conversation.messages,
        focusProduct: conversation.focusProduct,
        orderSpec: conversation.orderSpec,
      };

      const result = await app.directorAgent.handle(context, { message });
      app.conversations.appendLogs(conversation.id, result.logs);

      if (result.payload?.focusProduct) {
        app.conversations.setFocusProduct(conversation.id, result.payload.focusProduct);
      }
      if (result.payload?.orderSpec) {
        app.conversations.setOrderSpec(conversation.id, result.payload.orderSpec);
      }

      if (result.reply && app.amoCrm) {
        await app.amoCrm.sendDigitalPipelineMessage(body.dealId, result.reply, "widget");
      }

      res.status(201).json({ conversationId: conversation.id, reply: result.reply });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
