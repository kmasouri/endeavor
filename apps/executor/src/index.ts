import { DockerClient } from './docker.ts';
import { ExecutionService } from './execution.service.ts';
import { GitHubSource } from './github.ts';
import { config as settings } from './config.ts';
import { buildServer } from './server.ts';

const service = new ExecutionService(
  settings,
  new DockerClient(),
  new GitHubSource(settings.EXECUTOR_REPOSITORIES, settings.EXECUTOR_GITHUB_TOKEN)
);
await service.initialize();
const app = buildServer(service, settings.EXECUTOR_TOKEN);
const cleanup = setInterval(() => {
  void service.cleanup();
}, 60_000);
cleanup.unref();
app.addHook('onClose', async () => {
  clearInterval(cleanup);
  await service.close();
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void app.close();
  });
await app.listen({ host: settings.EXECUTOR_HOST, port: settings.EXECUTOR_PORT });
