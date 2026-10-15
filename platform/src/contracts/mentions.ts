const mentionPattern =
  /@\[([^\]\r\n]{1,160})\]\(asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\)/gi;
export function formatAssetMention(name: string, assetId: string): string {
  return `@[${name.replace(/[\]\r\n]/g, ' ').slice(0, 160) || '素材'}](asset:${assetId})`;
}
export function extractAssetMentions(text: string) {
  return [...text.matchAll(mentionPattern)].map(([token, name, assetId]) => ({
    token: token!,
    name: name!,
    assetId: assetId!.toLowerCase(),
  }));
}
