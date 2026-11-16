import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { z } from 'zod';
import type { Actor } from '../src/contracts/core';
import type { CoreServices, PreparedAsset } from '../src/server/core';

export const COMPARISON_WORKSPACE_NAME = '生成对比测试';
const importAction = 'comparison.fixtures.import.v1';
const receiptSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      brandId: z.uuid(),
      productId: z.uuid(),
      assetId: z.uuid(),
    }),
  ),
});

/** Fictional, deliberately dissimilar products; values are test inputs, not commercial claims. */
export const comparisonFixtures = [
  {
    key: 'mist-isle-cup',
    brand: {
      name: '雾屿（对比测试）',
      description:
        '虚构生活器物品牌，专用于生成对比测试。对外画面品牌名只写“雾屿”，不要写括号标记。定位：安静、自然、克制的日常器物。主色苔绿，辅色岩白与炭灰；柔和自然侧光、留白、细微纸感，避免荧光色和炫酷霓虹。文案短句，不夸张承诺。标记是两条起伏弧线组成的岛屿符号，不增加其他商标。',
      colors: ['#718268', '#F2EEE2', '#303A32'],
      fonts: ['思源黑体', '简洁中文无衬线'],
    },
    product: {
      name: '岩白随行杯450毫升（对比测试）',
      description:
        '虚构的日常随行杯。岩白色圆柱杯身，苔绿色旋盖，杯盖右侧有同色弧形提环；杯身正面为两条弧线符号。参考图是原创矢量示意，不是实物照片。',
      facts: [
        '画面产品名：岩白随行杯；所属品牌：雾屿。',
        '容量450毫升，杯身高度约19厘米，外径约7厘米。',
        '岩白色哑光杯身，苔绿色旋盖与右侧弧形提环。',
        '杯身正面保留两条弧线符号，下方容量标识为450毫升。',
        '这些规格仅为虚构测试设定，没有售价、促销或认证资料。',
      ],
      cautions: [
        '不能改为300毫升或500毫升，不能新增吸管或左侧杯把。',
        '不能编造保温时长、抗菌、材质认证或环保认证。',
        '不输出价格、折扣、销量、用户评价或未提供的配件。',
        '参考图底部的测试说明不是商品包装文字，不要复制到成品画面。',
      ],
    },
    imagePrompt:
      '为雾屿岩白随行杯制作一张1:1商品主视觉。只出现一个杯子，完整展示杯盖、右侧提环和杯底，主体居中偏右；左上留出约三分之一干净空间。苔绿与岩白色调，柔和自然侧光，浅色石台和细微纸感背景。画面仅写“轻装，慢行”和“450毫升”，不要其他文案、价格、认证或装饰文字。保持参考图中的外形、颜色和两条弧线符号。',
    videoPrompt:
      '制作5秒、16:9商品展示视频。一个雾屿岩白随行杯静置浅色石台，镜头缓慢从正面向右移动少量，始终完整展示杯盖、右侧提环和杯底；苔绿与岩白色调、柔和自然侧光。保持参考图外形、450毫升容量标识和两条弧线符号；不新增文字、人物、配件或功能演示。',
  },
  {
    key: 'jumpgrain-speaker',
    brand: {
      name: '跃粒（对比测试）',
      description:
        '虚构便携音频品牌，专用于生成对比测试。对外画面品牌名只写“跃粒”，不要写括号标记。定位：有节奏、轻巧、直接。主色活力橙，辅色近黑与米白；硬朗侧光、清晰几何色块和简洁构图。文案利落，不使用奢华金色或复古花纹。品牌符号为中间略高的三颗圆点，不增加其他商标。',
      colors: ['#FF6B2B', '#24282C', '#F7F1DF'],
      fonts: ['思源黑体', '加粗中文无衬线'],
    },
    product: {
      name: '方糖便携音箱（对比测试）',
      description:
        '虚构的单只便携蓝牙音箱。圆角方形活力橙机身、近黑色正面格栅，顶部三个按键，右上米白色提绳。正面小橙色标牌含三颗圆点。参考图是原创矢量示意，不是实物照片。',
      facts: [
        '画面产品名：方糖便携音箱；所属品牌：跃粒。',
        '机身尺寸约85×85×42毫米，单只音箱，额定功率6瓦。',
        '圆角方形橙色机身、黑色正面格栅，右上方米白色提绳。',
        '顶部从左至右为减号、播放、加号三个按键；正面标牌为三颗圆点。',
        '这些规格仅为虚构测试设定，没有续航、防水等级或售价资料。',
      ],
      cautions: [
        '不能改成圆柱体、双音箱或头戴耳机，不能改变顶部三个按键数量。',
        '不能编造防水等级、续航时长、降噪、语音助手或音质认证。',
        '不出现水花、浸水演示、售价、折扣或未提供的配件。',
        '参考图底部的测试说明不是商品包装文字，不要复制到成品画面。',
      ],
    },
    imagePrompt:
      '为跃粒方糖便携音箱制作一张1:1商品主视觉。只出现一个音箱，完整展示橙色机身、黑色格栅、顶部三个按键和右上米白提绳，主体居中偏右；左上留出约三分之一干净空间。橙黑米白配色，硬朗侧光，简洁几何台座。画面仅写“轻装，开声”和“6瓦”，不要其他文案、价格、认证或装饰文字。保持参考图中的外形、颜色和三颗圆点符号。',
    videoPrompt:
      '制作5秒、16:9商品展示视频。一个跃粒方糖便携音箱静置几何台座，镜头缓慢从正面向右移动少量，始终完整展示橙色机身、黑色格栅、顶部三个按键和右上米白提绳；橙黑米白配色、硬朗侧光。保持参考图外形和三颗圆点符号；不新增文字、人物、水花、配件或功能演示。',
  },
];

/**
 * Caller owns backup/restore verification and explicitly selects an existing comparison workspace.
 * An explicitly authorized current workspace must be bound to the exact user and workspace IDs.
 * No default database, credential loading, credit grants, model calls or automatic CLI execution.
 * Preparing media happens outside the transaction; all records and the durable receipt commit
 * together. The receipt lets later runs retain user edits and avoid name-based duplicates.
 */
export async function importComparisonFixtures(
  core: CoreServices,
  actor: Actor,
  workspaceId: string,
  options: {
    currentWorkspaceAuthorization?: { userId: string; workspaceId: string };
  } = {},
) {
  const c = core.context;
  const authorization = options.currentWorkspaceAuthorization;
  const authorize = () => {
    core.requireAccess(actor, workspaceId, 'owner');
    if (
      authorization &&
      (authorization.userId !== actor.userId || authorization.workspaceId !== workspaceId)
    )
      throw new Error('当前空间导入授权与实际用户或空间不一致');
    const workspace = c.get<{ name: string }>(
      'SELECT name FROM workspaces WHERE id=?',
      workspaceId,
    );
    if (workspace?.name !== COMPARISON_WORKSPACE_NAME && !authorization)
      throw new Error(`只允许导入明确命名为“${COMPARISON_WORKSPACE_NAME}”的独立空间`);
  };
  const existing = () => {
    const row = c.get<{ details_json: string }>(
      'SELECT details_json FROM audit_events WHERE workspace_id=? AND action=? ORDER BY created_at DESC LIMIT 1',
      workspaceId,
      importAction,
    );
    if (!row) return undefined;
    const receipt = receiptSchema.parse(JSON.parse(row.details_json));
    return {
      created: false,
      items: receipt.items.map((item) => ({
        ...item,
        brand: core.references.getBrand(actor, workspaceId, item.brandId),
        product: core.knowledge.getProduct(actor, workspaceId, item.productId),
        asset: core.assets.get(actor, workspaceId, item.assetId),
      })),
    };
  };
  authorize();
  const previous = existing();
  if (previous) return previous;
  const prepared: PreparedAsset[] = [];
  try {
    for (const fixture of comparisonFixtures) {
      const vector = await readFile(
        new URL(`../../design-assets/comparison-fixtures/${fixture.key}.svg`, import.meta.url),
      );
      prepared.push(
        await core.assets.prepare({
          buffer: await sharp(vector).png().toBuffer(),
          mimeType: 'image/png',
          name: `${fixture.product.name} · 原创参考示意图`,
          source: 'import',
          tags: ['虚构对比测试', '原创矢量示意', fixture.key],
        }),
      );
    }
    return c.transaction(() => {
      authorize();
      const raced = existing();
      if (raced) return raced;
      const items = comparisonFixtures.map((fixture, index) => {
        const media = prepared[index];
        if (!media) throw new Error('测试参考图准备不完整');
        const asset = core.assets.commitPrepared(actor, workspaceId, media);
        const brand = core.references.createBrand(actor, workspaceId, {
          ...fixture.brand,
          coverAssetId: asset.id,
          visibility: 'private',
        });
        const product = core.knowledge.createProduct(actor, workspaceId, {
          ...fixture.product,
          brandId: brand.id,
          referenceAssetIds: [asset.id],
          visibility: 'private',
        });
        return {
          key: fixture.key,
          brandId: brand.id,
          productId: product.id,
          assetId: asset.id,
          brand,
          product,
          asset,
        };
      });
      c.audit(actor, workspaceId, importAction, 'workspace', workspaceId, {
        destination: authorization ? 'explicit-current-workspace' : 'isolated-comparison-workspace',
        ...(authorization ? { authorizationTarget: { ...authorization } } : {}),
        items: items.map(({ key, brandId, productId, assetId }) => ({
          key,
          brandId,
          productId,
          assetId,
        })),
      });
      return { created: true, items };
    });
  } finally {
    // The transaction may return an earlier receipt after another importer wins the race.
    const committed = prepared.every(
      (asset) => !!c.get('SELECT id FROM assets WHERE id=?', asset.id),
    );
    if (!committed) await Promise.all(prepared.map((asset) => core.assets.discardPrepared(asset)));
  }
}
