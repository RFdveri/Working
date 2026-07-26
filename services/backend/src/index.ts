import { env } from "./config/env.js";
import { createServer } from "./api/server.js";
import { AppContainer } from "./core/AppContainer.js";

const app = new AppContainer();
const server = createServer(app);

server.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`AI Door Assistant backend listening on port ${env.port}`);
  if (!app.amoCrm) {
    // eslint-disable-next-line no-console
    console.warn("AmoCRM is not configured — set AMOCRM_* env vars to enable CRM operations.");
  }
});
