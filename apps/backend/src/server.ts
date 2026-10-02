/**
 * Backend entrypoint.
 */
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Local Live Tutor backend listening on http://${env.HOST}:${env.PORT}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
