import { env } from 'cloudflare:workers';
import { Store } from './store.ts';
import { AgentService } from './service.ts';
import { digest } from './crypto.ts';
export function service() {
  return new AgentService(
    new Store((env as any).DB),
    String((env as any).CREDENTIAL_ENCRYPTION_KEY ?? ''),
  );
}
export async function identity(request: Request) {
  const bearer = request.headers.get('authorization');
  if (bearer?.startsWith('Bearer ')) {
    const owner = await service().store.one(
      'SELECT owner FROM connections WHERE token_hash=?',
      await digest(bearer.slice(7)),
    );
    if (!owner) throw new Error('Invalid agent token');
    return { owner: owner.owner, agent: true };
  }
  const owner = request.headers.get('oai-authenticated-user-id');
  if (!owner) throw new Error('Sign in to access your position desk');
  return { owner, agent: false };
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    throw new Error('Cross-origin writes are not allowed');
  if (request.headers.get('sec-fetch-site') === 'cross-site')
    throw new Error('Cross-site writes are not allowed');
}
