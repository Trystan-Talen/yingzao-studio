import { parseSocialVideoLink, type SocialVideoPlatform } from '../../contracts/social-import';
import { ProviderError, type ProviderAdapter } from '../tasks/types';
import { providerJson } from './http';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Fields documented by TikHub's official Douyin/TikTok app-v3 client. */
export function decodeSocialVideo(value: unknown, platform: SocialVideoPlatform): string {
  const root = record(value);
  if (root.code !== 200)
    throw new ProviderError('分享解析未成功。请核对服务商记录和链接权限后再决定是否重新提交。');
  const data = record(root.data);
  const details = data.aweme_details;
  const item = record(
    data.aweme_detail ?? (Array.isArray(details) && details.length === 1 ? details[0] : undefined),
  );
  if (
    [2, 68, 150].includes(Number(item.aweme_type)) ||
    item.is_private === true ||
    item.is_private === 1
  )
    throw new ProviderError('此链接不是可导入的公开视频；请上传有权使用的原视频文件。');
  const video = record(item.video);
  const keys =
    platform === 'tiktok' ? ['play_addr_h264', 'play_addr'] : ['play_addr', 'play_addr_h264'];
  for (const key of keys) {
    const urls = record(video[key]).url_list;
    for (const candidate of Array.isArray(urls) ? urls : []) {
      if (typeof candidate !== 'string' || candidate.length > 8192) continue;
      try {
        const url = new URL(candidate);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.port)
          return url.href;
      } catch {
        /* An invalid candidate is not fetched. */
      }
    }
  }
  // A successful billed response with an unknown shape must not be resent automatically.
  throw new ProviderError(
    '解析服务已响应，但没有可核验的视频地址。请核对服务商记录；不要重复付费解析。',
    true,
    'IMPORT_RESPONSE_UNKNOWN',
  );
}

export const tikhubProvider: ProviderAdapter = {
  id: 'tikhub',
  async execute({ input }, secret) {
    if (input.operation !== 'media.import' || !secret)
      throw new ProviderError('视频解析服务未配置。');
    if (!input.options.referenceAuthorized || !input.options.externalCostAccepted)
      throw new ProviderError('请确认素材使用权与外部解析费用。');
    const { platform, url } = parseSocialVideoLink(input.linkUrl ?? '');
    const endpoint = new URL(
      `https://api.tikhub.io/api/v1/${platform}/app/v3/fetch_one_video_by_share_url`,
    );
    endpoint.searchParams.set('share_url', url);
    const result = await providerJson(endpoint.href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      timeoutMs: 60_000,
      submission: true,
    });
    return {
      state: 'complete',
      outputs: [
        {
          url: decodeSocialVideo(result, platform),
          mimeType: 'video/mp4',
          name: `分享视频-${platform === 'douyin' ? '抖音' : 'TikTok'}.mp4`,
        },
      ],
    };
  },
};
