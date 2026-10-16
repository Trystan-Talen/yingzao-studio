import { createServer, type Socket } from 'node:net';
import { once } from 'node:events';

/** A loopback-only SMTP fixture with no external delivery route. */
export async function localSmtp(
  options: {
    recipientCode?: number;
    dataCode?: number;
    dropAfterData?: boolean;
    onMessage?: (body: string) => void;
  } = {},
) {
  const sockets = new Set<Socket>();
  const messages: string[] = [];
  const recipients: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = '',
      body = '',
      data = false;
    socket.write('220 isolated localhost SMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            messages.push(body);
            options.onMessage?.(body);
            data = false;
            if (options.dropAfterData) {
              socket.destroy();
              return;
            }
            socket.write(`${options.dataCode ?? 250} test result\r\n`);
          } else body += line + '\r\n';
        } else if (/^(EHLO|HELO)/.test(line)) socket.write('250-localhost\r\n250 SIZE 1000000\r\n');
        else if (line.startsWith('MAIL FROM')) socket.write('250 sender ok\r\n');
        else if (line.startsWith('RCPT TO')) {
          recipients.push(line);
          socket.write(`${options.recipientCode ?? 250} recipient result\r\n`);
        } else if (line === 'DATA') {
          data = true;
          body = '';
          socket.write('354 enter data\r\n');
        } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('500 unsupported\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback SMTP port');
  return {
    port: address.port,
    messages,
    recipients,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

export function mailText(raw: string) {
  const decoded = raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  const plain = [
    ...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g),
  ].map((m) => Buffer.from(m[1]!, 'base64').toString('utf8'));
  return [decoded, ...plain].join('\n');
}
