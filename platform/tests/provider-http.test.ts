import { afterEach, describe, expect, it, vi } from 'vitest';
import { providerJson } from '../src/server/providers/http';

afterEach(() => vi.unstubAllGlobals());

describe('provider response cleanup', () => {
  it.each([401, 429, 503])(
    'cancels rejected HTTP %i bodies without consuming their content',
    async (status) => {
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status })));

      await expect(
        providerJson('https://provider.example.test/run', { submission: true }),
      ).rejects.toMatchObject({ code: `PROVIDER_HTTP_${status}`, ambiguous: status >= 500 });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    },
  );

  it('cancels an oversized declared body before reading it', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'content-length': String(161 * 1024 * 1024) },
        }),
      ),
    );

    await expect(
      providerJson('https://provider.example.test/run', { submission: true }),
    ).rejects.toThrow('大小限制');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(['{"ok":true}', 'invalid-json'])(
    'releases the reader after a complete response: %s',
    async (text) => {
      const response = new Response(text);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      if (text.startsWith('{')) {
        await expect(providerJson('https://provider.example.test/run')).resolves.toEqual({
          ok: true,
        });
      } else {
        await expect(providerJson('https://provider.example.test/run')).rejects.toThrow('无法解析');
      }
      expect(response.body?.locked).toBe(false);
    },
  );

  it('releases the reader after a stream failure and keeps uncertain submissions marked for reconciliation', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('synthetic-sensitive-provider-error'));
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));

    await expect(
      providerJson('https://provider.example.test/run', { submission: true }),
    ).rejects.toMatchObject({ ambiguous: true, message: '服务商返回无法解析的响应。' });
    expect(body.locked).toBe(false);
  });
});
