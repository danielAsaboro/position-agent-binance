const base = process.env.POSITION_AGENT_URL,
  token = process.env.POSITION_AGENT_TOKEN;
if (!base || !token)
  throw new Error('Set POSITION_AGENT_URL and POSITION_AGENT_TOKEN');
let running = true;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    running = false;
  });
while (running) {
  const start = Date.now();
  try {
    const r = await fetch(new URL('/api/agent/monitor', base), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) throw new Error(`Monitor request returned HTTP ${r.status}`);
    const results = await r.json();
    process.stdout.write(
      JSON.stringify({
        time: new Date().toISOString(),
        checked: results.length,
        errors: results
          .filter((x) => x.error)
          .map((x) => ({ id: x.id, error: x.error })),
      }) + '\n',
    );
  } catch (e) {
    process.stderr.write(`${new Date().toISOString()} ${e.message}\n`);
  }
  if (process.argv.includes('--once')) break;
  await new Promise((r) =>
    setTimeout(r, Math.max(1000, 60000 - (Date.now() - start))),
  );
}
