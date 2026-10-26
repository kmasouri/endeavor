import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitHubSource } from './github.ts';

test('only fetches allowed repositories, pins commits, and withholds credentials on redirects', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; authorization: string | null }[] = [];
  const sha = 'f'.repeat(40);
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      authorization: new Headers(init?.headers).get('authorization')
    });
    if (calls.length === 1) return new Response(JSON.stringify({ sha }));
    if (calls.length === 2)
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://codeload.github.com/owner/repo/legacy.tar.gz/${sha}?signed=1`
        }
      });
    return new Response('archive');
  };
  try {
    const source = new GitHubSource(['owner/repo'], 'provider-secret');
    await assert.rejects(source.snapshot('another/repo', 'main'), /not enabled/);
    assert.equal(calls.length, 0);
    const result = await source.snapshot('owner/repo', 'refs/pull/10/head');
    assert.equal(result.sha, sha);
    assert.equal(Buffer.from(result.archive, 'base64').toString(), 'archive');
    assert.match(calls[0].url, /refs%2Fpull%2F10%2Fhead$/);
    assert.match(calls[1].url, new RegExp(`/tarball/${sha}$`));
    assert.equal(calls[0].authorization, 'Bearer provider-secret');
    assert.equal(calls[2].authorization, null);
  } finally {
    globalThis.fetch = original;
  }
});

test('rejects archive redirects outside GitHub before forwarding credentials or making another request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ sha: 'f'.repeat(40) }))
      : new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example/archive' }
        });
  };
  try {
    await assert.rejects(
      new GitHubSource(['owner/repo'], 'secret').snapshot('owner/repo', 'main'),
      /unsupported archive redirect/
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});
