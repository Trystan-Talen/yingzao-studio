import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
/** Test-only loopback gateway, never mounted by the product application. */
export async function localSms() {
  const secret = randomBytes(32).toString('hex');
  const messages: { phone: string; code: string; requestId: string }[] = [];
  const server = createServer((request, response) => {
    if (
      request.method !== 'POST' ||
      request.url !== '/sms' ||
      request.headers.authorization !== `Bearer ${secret}`
    ) {
      response.writeHead(403).end();
      return;
    }
    let body = '';
    request.on('data', (data: Buffer) => {
      body += data.toString();
      if (body.length > 4096) request.destroy();
    });
    request.on('end', () => {
      try {
        const input = JSON.parse(body) as { phone: string; code: string; requestId: string };
        if (
          !/^\+861[3-9]\d{9}$/.test(input.phone) ||
          !/^\d{6}$/.test(input.code) ||
          !/^[a-f0-9-]{36}$/i.test(input.requestId)
        )
          throw new Error('Invalid test payload');
        messages.push(input);
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{"status":"accepted"}');
      } catch {
        response.writeHead(400).end();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local test port');
  return {
    port: address.port,
    secret,
    messages,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      );
    },
  };
}
