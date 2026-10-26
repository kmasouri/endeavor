import { OperationError } from './errors.ts';
import { z } from 'zod';

const commitSchema = z.object({ sha: z.string().regex(/^[a-f0-9]{40,64}$/) });
async function limited(response: Response, max: number): Promise<Buffer> {
  if (!response.ok || !response.body)
    throw new OperationError('GitHub request failed; check repository access and ref');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > max) {
      await response.body.cancel().catch(() => undefined);
      throw new OperationError('Repository archive exceeds 20 MB');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export interface RepositorySource {
  snapshot(repository: string, ref: string): Promise<{ sha: string; archive: string }>;
}
export class GitHubSource implements RepositorySource {
  private readonly repositories: string[];
  private readonly token?: string;
  constructor(repositories: string[], token?: string) {
    this.repositories = repositories;
    this.token = token;
  }

  async snapshot(repository: string, ref: string): Promise<{ sha: string; archive: string }> {
    if (!this.repositories.includes(repository.toLowerCase()))
      throw new OperationError('Repository is not enabled by the executor operator');
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'endeavor-executor',
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
    };
    const request = (url: string, authenticated = true) =>
      fetch(url, {
        headers: authenticated ? headers : { 'User-Agent': 'endeavor-executor' },
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000)
      });
    const commit = await request(
      `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(ref)}`
    );
    const { sha } = commitSchema.parse(JSON.parse((await limited(commit, 1_000_000)).toString()));
    let response = await request(`https://api.github.com/repos/${repository}/tarball/${sha}`);
    if (response.status === 302) {
      const location = new URL(response.headers.get('location') ?? '');
      await response.body?.cancel();
      if (
        location.protocol !== 'https:' ||
        location.hostname !== 'codeload.github.com' ||
        location.port ||
        location.username ||
        location.password
      )
        throw new OperationError('GitHub returned an unsupported archive redirect');
      // Signed GitHub archive URLs do not receive the provider credential again.
      response = await request(location.href, false);
    }
    return { sha, archive: (await limited(response, 20_000_000)).toString('base64') };
  }
}
