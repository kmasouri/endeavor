import { config } from './config';
import { setupApp } from './app';

async function main(): Promise<void> {
  const app = setupApp();

  const shutdown = async () => {
    await app.close();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
