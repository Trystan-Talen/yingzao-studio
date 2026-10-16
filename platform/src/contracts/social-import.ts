export type SocialVideoPlatform = 'douyin' | 'tiktok';
/** Extract one public share URL; never resolve a user supplied redirect on the application host. */
export function parseSocialVideoLink(text: string): { platform: SocialVideoPlatform; url: string } {
  const links = text.trim().match(/https?:\/\/[^\s<>"“”]+/gi) ?? [];
  if (links.length !== 1) throw new Error('请粘贴包含一个公开视频链接的分享内容。');
  let url: URL;
  try {
    url = new URL(links[0]!.replace(/[。，、；！？）)\]}]+$/u, ''));
  } catch {
    throw new Error('分享链接格式无效。');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('请使用不含登录信息或自定义端口的 HTTPS（安全连接）分享链接。');
  const hosts = {
    douyin: ['www.douyin.com', 'douyin.com', 'v.douyin.com', 'www.iesdouyin.com'],
    tiktok: ['www.tiktok.com', 'tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  } as const;
  if (
    ['xiaohongshu.com', 'www.xiaohongshu.com', 'xhslink.com', 'xhslink.cn'].includes(url.hostname)
  )
    throw new Error(
      '小红书解析尚未完成返回格式核验，请先上传有权使用的视频文件；本次不会调用解析服务。',
    );
  const platform = (Object.keys(hosts) as SocialVideoPlatform[]).find((key) =>
    (hosts[key] as readonly string[]).includes(url.hostname),
  );
  if (!platform || url.pathname === '/')
    throw new Error('目前支持抖音和 TikTok（国际版抖音）的公开视频分享链接。');
  url.hash = '';
  return { platform, url: url.href };
}
