import { service, identity, sameOrigin } from '@/lib/agent/runtime';
import { Binance } from '@/lib/agent/binance';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
async function handler(request: Request) {
  try {
    const path = new URL(request.url).pathname
      .replace('/api/agent/', '')
      .split('/');
    if (request.method === 'GET' && path[0] === 'market')
      return json(await new Binance().market());
    if (request.method === 'GET' && path[0] === 'health')
      return json({ status: 'ok', exchange: 'not_probed', time: Date.now() });
    if (request.method === 'GET' && path[0] === 'guide')
      return new Response(
        `# Position Agent integration\n\nRun the stdio MCP bridge from this project's scripts/mcp-bridge.mjs with POSITION_AGENT_URL and POSITION_AGENT_TOKEN in your client environment.\n\nTools: list_position_mandates, assess_position, reconcile_position_order, monitor_positions.\n\nNo tool can approve an exchange order. Open the dashboard to review and approve.\n\nFor continuous monitoring run scripts/monitor.mjs with the same environment. It checks once per minute and never approves orders.\n\nOwner-private hosting requires platform sign-in; remote machine access depends on your hosting authentication. Use the local authenticated app endpoint for the bridge until remote service access is verified.\n`,
        { headers: { 'Content-Type': 'text/plain' } },
      );
    const user = await identity(request);
    const s = service();
    if (request.method === 'GET') {
      if (path[0] === 'state') return json(await s.state(user.owner));
      if (path[0] === 'positions')
        return json(await (await s.exchange(user.owner)).positions());
      return json({ error: 'Not found' }, 404);
    }
    sameOrigin(request);
    if (!request.headers.get('content-type')?.includes('application/json'))
      return json({ error: 'JSON request required' }, 415);
    if (Number(request.headers.get('content-length') ?? 0) > 16000)
      return json({ error: 'Request too large' }, 413);
    const raw = await request.text();
    if (raw.length > 16000) return json({ error: 'Request too large' }, 413);
    const body = JSON.parse(raw || '{}');
    if (
      user.agent &&
      !(
        (path[0] === 'mandates' && path[2] === 'assess') ||
        (path[0] === 'proposals' && path[2] === 'reconcile') ||
        path[0] === 'monitor'
      )
    )
      return json(
        {
          error:
            'Agent tokens cannot approve orders or change account settings',
        },
        403,
      );
    if (path[0] === 'connection')
      return json(await s.connect(user.owner, body));
    if (path[0] === 'disconnect') return json(await s.disconnect(user.owner));
    if (path[0] === 'token') return json(await s.token(user.owner));
    if (path[0] === 'monitor') return json(await s.monitor(user.owner));
    if (path[0] === 'mandates') {
      if (path.length === 1) return json(await s.saveMandate(user.owner, body));
      if (path[2] === 'edit')
        return json(await s.saveMandate(user.owner, body, path[1]));
      if (path[2] === 'status')
        return json(await s.status(user.owner, path[1], body.status));
      if (path[2] === 'assess')
        return json(await s.evaluate(user.owner, path[1]));
    }
    if (path[0] === 'proposals') {
      if (path[2] === 'approve')
        return json(await s.approve(user.owner, path[1], body.confirmation));
      if (path[2] === 'reject')
        return json(await s.reject(user.owner, path[1]));
      if (path[2] === 'reconcile')
        return json(await s.reconcile(user.owner, path[1]));
    }
    return json({ error: 'Not found' }, 404);
  } catch (e: any) {
    return json(
      { error: e instanceof Error ? e.message : 'Request failed' },
      e.message?.includes('Sign in') ||
        e.message?.includes('Invalid agent token')
        ? 401
        : 400,
    );
  }
}
export const GET = handler;
export const POST = handler;
