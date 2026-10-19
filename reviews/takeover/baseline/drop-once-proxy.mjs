// Local verification only: forward to the isolated app and lose one accepted job response.
// Never use this proxy against production or a paid provider.
import http from 'node:http';
const target = new URL(process.env.TEST_PROXY_TARGET ?? 'http://127.0.0.1:5174');
const port = Number(process.env.TEST_PROXY_PORT ?? 5178);
let dropped = false;
const server = http.createServer((incoming, outgoing) => {
  const headers = { ...incoming.headers, host: target.host };
  if (headers.origin) headers.origin = target.origin;
  if (headers.referer) headers.referer = headers.referer.replace(/^https?:\/\/[^/]+/, target.origin);
  const upstream = http.request(new URL(incoming.url ?? '/', target), {
    method: incoming.method, headers,
  }, (response) => {
    if (!dropped && incoming.method === 'POST' && incoming.url === '/api/v1/jobs' && response.statusCode === 202) {
      dropped = true;
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const payload = JSON.parse(Buffer.concat(chunks).toString());
        console.log(JSON.stringify({ event: 'accepted-response-dropped', jobId: payload.data.id, status: payload.data.status, projectId: payload.data.projectId }));
        outgoing.destroy();
      });
      return;
    }
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  upstream.on('error', () => { outgoing.writeHead(502); outgoing.end('Test proxy upstream unavailable'); });
  incoming.pipe(upstream);
});
server.listen(port, '127.0.0.1', () => console.log(`Local fault proxy ready on http://127.0.0.1:${port}; upstream ${target.origin}`));
process.on('SIGTERM', () => server.close());
