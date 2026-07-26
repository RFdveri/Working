import { createAmoCrmClient } from "../integrations/amocrm/index.js";
import type { AmoCrmClient } from "../integrations/amocrm/AmoCrmClient.js";
import { createCatalogClient, createProductConfiguratorClient } from "../integrations/catalog/index.js";
import type { CatalogClient } from "../integrations/catalog/CatalogClient.js";
import type { ProductConfiguratorClient } from "../integrations/catalog/ProductConfiguratorClient.js";
import { createLlmProvider } from "../integrations/llm/index.js";
import type { LlmProvider } from "../integrations/llm/LlmProvider.js";
import { MockOcrProvider, type OcrProvider } from "../integrations/ocr/OcrProvider.js";
import { MockSttProvider, type SttProvider } from "../integrations/stt/SttProvider.js";
import { createServicePriceProvider } from "../integrations/pricing/index.js";
import type { ServicePriceProvider } from "../integrations/pricing/ServicePriceProvider.js";
import {
  CrmAgent,
  DirectorAgent,
  DocumentAgent,
  HumanSalesAgent,
  MaterialExpertAgent,
  PriceAgent,
  ProductAgent,
  SearchAgent,
  SummaryAgent,
  TaskAgent,
  VisionAgent,
  VoiceAgent,
} from "../agents/index.js";
import { ConversationManager } from "./conversation/ConversationManager.js";
import { SqliteMemoryStore, type MemoryStore } from "./memory/MemoryStore.js";
import { openDatabase } from "./persistence/Database.js";

/**
 * Wires every integration and agent together. This is the single place that
 * knows concrete implementations — everything else (agents, routes) depends
 * only on the interfaces, so swapping a mock provider for a real one later
 * (Whisper, OCR, a real catalog API) only touches this file.
 */
export class AppContainer {
  readonly amoCrm: AmoCrmClient | null;
  readonly catalog: CatalogClient;
  readonly productConfigurator: ProductConfiguratorClient;
  readonly llm: LlmProvider;
  readonly ocr: OcrProvider;
  readonly stt: SttProvider;
  readonly servicePrices: ServicePriceProvider;

  readonly conversations: ConversationManager;
  readonly memory: MemoryStore;

  readonly crmAgent: CrmAgent;
  readonly productAgent: ProductAgent;
  readonly searchAgent: SearchAgent;
  readonly priceAgent: PriceAgent;
  readonly materialExpertAgent: MaterialExpertAgent;
  readonly humanSalesAgent: HumanSalesAgent;
  readonly visionAgent: VisionAgent;
  readonly documentAgent: DocumentAgent;
  readonly voiceAgent: VoiceAgent;
  readonly taskAgent: TaskAgent;
  readonly summaryAgent: SummaryAgent;
  readonly directorAgent: DirectorAgent;

  constructor() {
    const db = openDatabase(process.env.DATABASE_PATH ?? "./data/app.db");
    this.conversations = new ConversationManager(db);
    this.memory = new SqliteMemoryStore(db);

    this.amoCrm = createAmoCrmClient();
    this.catalog = createCatalogClient();
    this.productConfigurator = createProductConfiguratorClient();
    this.llm = createLlmProvider();
    this.ocr = new MockOcrProvider();
    this.stt = new MockSttProvider();
    this.servicePrices = createServicePriceProvider();

    this.crmAgent = new CrmAgent(this.amoCrm);
    this.productAgent = new ProductAgent(this.catalog);
    this.searchAgent = new SearchAgent(this.catalog);
    this.priceAgent = new PriceAgent(this.catalog, this.servicePrices, this.productConfigurator);
    this.materialExpertAgent = new MaterialExpertAgent(this.llm);
    this.humanSalesAgent = new HumanSalesAgent(this.llm);
    this.visionAgent = new VisionAgent(this.llm);
    this.documentAgent = new DocumentAgent(this.ocr);
    this.voiceAgent = new VoiceAgent(this.stt);
    this.taskAgent = new TaskAgent(this.amoCrm);
    this.summaryAgent = new SummaryAgent(this.llm, this.amoCrm);

    this.directorAgent = new DirectorAgent(
      this.searchAgent,
      this.priceAgent,
      this.productAgent,
      this.humanSalesAgent,
      this.visionAgent,
      this.documentAgent,
      this.voiceAgent,
      this.crmAgent
    );
  }
}
