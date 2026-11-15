import type { CreativeIntentRequest, CreativeIntentResult } from '../../contracts/creative-intent';
import type { JobInput } from '../../contracts/jobs';
import { nativeReferenceFrameIssue } from '../../contracts/native-plan';
export { nativeReferenceFrameIssue } from '../../contracts/native-plan';

/** A cropped photo viewport is a distinct, disclosed operation. Never silently
 * replace a requested generative video or an unchanged full-frame first image.
 */
export function usesExactPan(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): boolean {
  if (result.generationPlan?.cameraControl?.type !== 'translate') return false;
  return acceptsExactPanCrop(request);
}

/** Retiming is opt-in through the latest user instruction and a separately disclosed
 * frozen plan. It must never change an existing plan or a dynamic scene by inference. */
export function usesModelVideoTailHold(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): boolean {
  if (
    result.generationPlan?.cameraControl?.type !== 'zoom' ||
    result.generationPlan.firstFrame?.mode !== 'reference' ||
    validateNativeCameraControl(result, request) ||
    validateNativeFirstFrame(result, request) ||
    ![5, 10].includes(request.context.duration ?? 0)
  )
    return false;
  const text = request.answers.at(-1)?.answer ?? request.rawPrompt;
  if (
    /(?:不允许|禁止|不要|不能|不得|无需|不做|不用).{0,10}(?:后处理|本机处理|重采样|重定时|变速|改变.{0,3}时序)|(?:必须|仅|只)(?:使用|保留)?(?:模型)?原片/.test(
      text,
    )
  )
    return false;
  const clauses = text.split(/[，,。！？!?;；\n]/);
  if (
    clauses.some((clause) => {
      const dynamic =
        /(?:水|液体|烟雾|蒸汽|火焰|烛光|布料|窗帘|头发|人物|人|动物|手).{0,8}(?:流动|晃动|飘动|升起|飞扬|摆动|闪烁|转动|走动|行走|挥动|动作)|(?:随|跟随).{0,6}(?:音乐|节奏)|(?:同步|对齐).{0,6}(?:声音|音轨|口型)/.exec(
          clause,
        );
      return !!dynamic && !/(?:不|不要|禁止|无|避免).{0,8}$/.test(clause.slice(0, dynamic.index));
    })
  )
    return false;
  return clauses.some((clause) => {
    const match =
      /(?:最后|末尾|结尾)(?:的)?\s*(?:0[.．]5|半)\s*秒.{0,8}(?:停稳|静止|保持(?:不动|末帧|静止))/.exec(
        clause,
      );
    return !!match && !/(?:不|无需|不要|不能|禁止).{0,8}/.test(clause);
  });
}

/** A planning-cost floor, never an execution plan or a client-selected discount. */
export function canPlanExactPan(request: CreativeIntentRequest): boolean {
  if (
    request.context.mediaType !== 'video' ||
    !request.context.supportsMotionEndpoints ||
    !acceptsExactPanCrop(request)
  )
    return false;
  const text = request.answers.at(-1)?.answer ?? request.rawPrompt;
  const amounts = [
    2,
    ...[...text.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g)].map((match) => Number(match[1])),
  ].filter((value) => value >= 1 && value <= 3);
  return (['left', 'right'] as const).some((direction) =>
    amounts.some((displacementPercent) =>
      hasConfirmedCameraIntent(request, { type: 'translate', direction, displacementPercent }),
    ),
  );
}

/** Crop permission does not authorize replacing depth/parallax/focus changes with a flat image. */
function requestsSpatialChange(text: string): boolean {
  const clauses = text.split(/[，,。！？!?;；\n]|但是|而是|不过|\bbut\b/i);
  return clauses.some((clause) => {
    const effects = clause.matchAll(
      /视差|\bparallax\b|(?:三维|3d|three[- ]dimensional).{0,12}?(?:运镜|相机|镜头|camera)|(?:改变|变化|调整|调节).{0,3}景深|景深.{0,3}(?:改变|变化|变浅|加深)|拉焦|焦点转移|\b(?:rack focus|focus pull)\b|(?:前景|背景|前后层|前后景|前后景层|近景|远景|各层|不同层).{0,12}?(?:不同|差异|各自).{0,5}?(?:移动|平移|横移)|(?:前景|背景|近景|远景).{0,6}?(?:移动|平移|横移).{0,4}?比.{0,8}?(?:快|慢)/gi,
    );
    return [...effects].some((effect) => {
      const prefix = clause.slice(0, effect.index);
      const suffix = clause.slice(effect.index! + effect[0].length);
      if (
        /(?:不能没有|不得没有|不可没有|不可以没有|不是不要|不是不需要|并非不需要|不要没有).{0,8}$/.test(
          prefix,
        )
      )
        return true;
      const negated =
        /(?:不需要|不要|无需|不用|不做|不改|不产生|不允许|禁止|避免|不|无|without|\bno\b|\bnot\b).{0,12}$/i.test(
          prefix,
        );
      const unchanged = /^(?:保持)?(?:不变|固定|不动|不需要|无需)/.test(suffix);
      return !negated && !unchanged;
    });
  });
}

function acceptsExactPanCrop(request: CreativeIntentRequest): boolean {
  const text = request.answers.at(-1)?.answer ?? request.rawPrompt;
  if (requestsSpatialChange(text)) return false;
  const clauses = text.split(/[，,。！？!?;；\n]/);
  const requiresModel = clauses.some((clause) => {
    const match = /(?:必须|只用|仅用|要求|使用|通过|调用).{0,8}视频模型|视频模型(?:生成|制作)/.exec(
      clause,
    );
    return match && !/(?:不|无需|不要|不能|禁止|不用).{0,6}$/.test(clause.slice(0, match.index));
  });
  if (
    requiresModel ||
    /原样(?:作为)?首帧|首帧.{0,8}(?:完全不变|原样|不裁)|(?:不允许|不要|不能|不得|禁止|不)(?:任何|少量)?裁(?:切|剪|掉)/.test(
      text,
    )
  )
    return false;
  return clauses.some(
    (clause) =>
      /(?:允许|可以|可接受|接受)(?:对|将|做|进行|少量|小幅|轻微|适量|四周|两侧|边缘|背景|留白|\s){0,12}裁(?:切|剪|掉)/.test(
        clause,
      ) && /背景|边缘|留白/.test(clause),
  );
}

/** Validate a planner-selected asset against trusted request metadata, never its filename. */
export function validateNativeFirstFrame(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): { path: string; code: string } | undefined {
  const frame = result.generationPlan?.firstFrame;
  if (frame?.mode !== 'reference') return;
  const material = request.materials.find(
    (item) =>
      item.id === frame.assetId &&
      item.kind === 'image' &&
      (item.role === 'input' || item.role === 'reference'),
  );
  if (!material || !request.context.supportsReference)
    return { path: 'generationPlan.firstFrame.assetId', code: 'FIRST_FRAME_REFERENCE_INVALID' };
  const code = nativeReferenceFrameIssue(material, request.context.ratio);
  if (code) return { path: 'generationPlan.firstFrame', code };
}

export function validateNativeCameraControl(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): { path: string; code: string } | undefined {
  if (!result.generationPlan?.cameraControl) return;
  if (
    result.status !== 'ready' ||
    result.brief.mediaType !== 'video' ||
    request.context.mediaType !== 'video' ||
    !request.context.supportsMotionEndpoints
  )
    return { path: 'generationPlan.cameraControl', code: 'CAMERA_ENDPOINT_UNSUPPORTED' };
  if (
    result.generationPlan.firstFrame?.mode !== 'reference' ||
    result.brief.scope !== 'product' ||
    result.brief.productMode !== 'reference'
  )
    return { path: 'generationPlan.cameraControl', code: 'CAMERA_REFERENCE_REQUIRED' };
  if (!hasConfirmedCameraIntent(request, result.generationPlan.cameraControl))
    return { path: 'generationPlan.cameraControl', code: 'CAMERA_INTENT_UNCONFIRMED' };
}

/** This optional geometric transform needs explicit user intent, not the planner's
 * inference or instructions copied from an attachment. Recognize a narrow subset;
 * unsupported wording remains eligible for ordinary generative video planning.
 */
function hasConfirmedCameraIntent(
  request: CreativeIntentRequest,
  control: NonNullable<NonNullable<JobInput['nativePlan']>['cameraControl']>,
): boolean {
  const positive = (clause: string, pattern: RegExp) => {
    const match = pattern.exec(clause);
    if (!match) return false;
    return !/(?:不|别|勿|禁止|避免|取消|无需|不要|不能|无(?=环绕|绕拍|旋转|转动|转台|摆动|变焦|推近|拉远|升降|视差|俯仰|缩放)|without|\bno\b|\bnot\b|don't|never)[^，,。;；]{0,12}$/i.test(
      clause.slice(0, match.index),
    );
  };
  // A later answer can revoke any earlier static-scene assumption. Only the latest
  // user-authored instruction can opt into this optional geometric transform.
  const text = request.answers.at(-1)?.answer ?? request.rawPrompt;
  if (requestsSpatialChange(text)) return false;
  const clauses = text.split(/[，,。！？!?;；\n]/).map((clause) => clause.trim());
  const staticHere = clauses.some((clause) =>
    positive(
      clause,
      /(?:主体|商品|产品|物体|物件)(?:保持|完全|全程|始终|均|全部|都|一直|必须|应|需|要|\s)*(?:静止|不动)|\b(?:product|subject|objects?)\s+(?:(?:remain|stay|is|are|completely|fully)\s+)*(?:stationary|still)\b|\bstationary\s+(?:product|subject|objects?)\b/i,
    ),
  );
  if (control.type === 'zoom') {
    const fixedPosition = clauses.some((clause) =>
      positive(clause, /固定(?:相机)?机位|(?:相机)?机位(?:和朝向)?(?:保持)?(?:固定|不变)/),
    );
    const fixedCenter = clauses.some((clause) =>
      positive(clause, /固定画面中心|画面中心(?:保持)?(?:固定|不变)/),
    );
    const explicitZoom = clauses.some((clause) => positive(clause, /等比放大|光学变焦/));
    const requestedScales: number[] = [];
    let incompatible = false;
    for (const clause of clauses) {
      if (
        positive(
          clause,
          /环绕|旋转|转动|转台|摆动|平移|横移|微移|移动|推近|拉近|拉远|升降|贴边|缩小|变小|持续运动|改变(?:机位|朝向)|\borbit|\brotat|\bpan\b|\btranslate/i,
        ) ||
        /(?:结尾|最后|全程).{0,8}(?:不要停|不停|无需停|继续放大)/.test(clause) ||
        /(?:不允许|不要|不能|不得|禁止|不)(?:任何)?裁切/.test(clause)
      )
        incompatible = true;
      if (!/放大|变焦/.test(clause)) continue;
      if (!positive(clause, /放大|变焦/)) incompatible = true;
      const amounts = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g)];
      const range =
        /从\s*(\d+(?:\.\d+)?)\s*[%％]\s*等比放大(?:到|至)\s*(\d+(?:\.\d+)?)\s*[%％]/.exec(clause);
      if (range) {
        // An explicit source scale is allowed only as the unchanged 100% first frame.
        // Do not reinterpret two arbitrary percentages or a multi-stage zoom as one endpoint.
        if (Number(range[1]) !== 100 || amounts.length !== 2) incompatible = true;
        requestedScales.push(Number(range[2]));
        continue;
      }
      for (const amount of amounts) {
        const value = Number(amount[1]);
        const prefix = clause.slice(0, amount.index);
        if (/(?:放大|变焦)(?:到|至|为)(?:(?:起始|首帧|原图)(?:尺寸|大小)?的?)?\s*$/.test(prefix))
          requestedScales.push(value);
        else if (/(?:等比放大|光学变焦)(?:约|增加|增大|提升|\s)*$/.test(prefix))
          requestedScales.push(100 + value);
        else incompatible = true;
      }
    }
    return (
      staticHere &&
      fixedPosition &&
      fixedCenter &&
      explicitZoom &&
      !incompatible &&
      requestedScales.length === 1 &&
      Math.abs(requestedScales[0]! - control.scalePercent) < 0.000001
    );
  }
  let requested: 'left' | 'right' | undefined;
  let requestedAmount: number | undefined;
  let incompatible = false;
  for (const clause of clauses) {
    const standaloneAmount =
      /(?:幅度|(?:最终|总)?位移)[^，,。;；]{0,10}?(?:画面宽度|画宽)(?:的)?\s*(\d+(?:\.\d+)?)\s*[%％]/.exec(
        clause,
      );
    if (
      standaloneAmount &&
      Math.abs(Number(standaloneAmount[1]) - control.displacementPercent) > 0.000001
    )
      incompatible = true;
    if (
      /(?:固定镜头|(?:镜头|相机)(?:保持|始终|全程)?(?:固定|不动|不移动|不要移动)|取消(?:运镜|平移)|^(?:不要|别再|不再)(?:小幅|轻微)?(?:平移|移动)|(?:static|fixed|locked)\s+camera)/i.test(
        clause,
      )
    )
      incompatible = true;
    if (/(?:结尾|最后|全程).{0,8}(?:不要停|不停|无需停|继续移动)/.test(clause)) incompatible = true;
    if (
      positive(
        clause,
        /环绕|旋转|转动|转台|摆动|变焦|推近|拉远|升降|持续运动|一直移动|贴边|\borbit|\bzoom|\brotat/i,
      )
    )
      incompatible = true;
    const motions = [
      ...clause.matchAll(
        /(?:向|往)?(左|右)(?:侧|方)?[^，,。;；]{0,12}?(?:平移|横移|微移|移动|移)|\b(?:track|slide|translate|move)(?:s|ing)?\b[^,;]{0,24}?\b(left|right)\b/gi,
      ),
    ];
    const motion = motions[0];
    if (!motion || !/(?:镜头|相机|\bcamera\b)/i.test(clause.slice(0, motion.index))) continue;
    if (motions.length !== 1) incompatible = true;
    if (
      !positive(
        clause,
        /(?:向|往)?(?:左|右)(?:侧|方)?[^，,。;；]{0,12}?(?:平移|横移|微移|移动|移)|\b(?:track|slide|translate|move)(?:s|ing)?\b/i,
      )
    ) {
      incompatible = true;
      continue;
    }
    const percentages = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*[%％]/g)].map((match) =>
      Number(match[1]),
    );
    const small = /小幅|微微|轻微|轻移|微移|微小|很小|\btiny\b|\bsubtle\b|\bslight|\bsmall\b/i.test(
      clause,
    );
    if (
      percentages.length > 1 ||
      (percentages.length === 0 && !small) ||
      percentages.some((value) => value < 1 || value > 3)
    ) {
      incompatible = true;
      continue;
    }
    const direction = motion[1]
      ? motion[1] === '左'
        ? 'left'
        : 'right'
      : (motion[2]!.toLowerCase() as 'left' | 'right');
    if (requested && requested !== direction) incompatible = true;
    requested = direction;
    if (percentages[0] !== undefined) {
      if (requestedAmount !== undefined && Math.abs(requestedAmount - percentages[0]) > 0.000001)
        incompatible = true;
      requestedAmount = percentages[0];
    }
  }
  return (
    staticHere &&
    !incompatible &&
    requested === control.direction &&
    (requestedAmount === undefined ||
      Math.abs(requestedAmount - control.displacementPercent) < 0.000001)
  );
}

/** Each stage already contains its resolved directions. Appending the whole brief again
 * mixes camera instructions into the still and can introduce a second camera strategy.
 * Keep provenance, recommendations and the review checklist out of model instructions.
 */
export function compileNativeVideoPlan(
  result: CreativeIntentResult,
  request: CreativeIntentRequest,
): JobInput['nativePlan'] {
  if (result.status !== 'ready' || result.brief.mediaType !== 'video' || !result.generationPlan)
    return undefined;
  const invalidFrame = validateNativeFirstFrame(result, request);
  if (invalidFrame) throw new Error(invalidFrame.code);
  const invalidCamera = validateNativeCameraControl(result, request);
  if (invalidCamera) throw new Error(invalidCamera.code);
  const plan = result.generationPlan;
  const exactPan =
    usesExactPan(result, request) && plan.cameraControl?.type === 'translate'
      ? plan.cameraControl
      : undefined;
  const reference = request.materials.some(
    (item) => item.kind === 'image' && (item.role === 'input' || item.role === 'reference'),
  );
  const preserve =
    reference && result.brief.productMode === 'reference'
      ? '商品外观以参考图为准：轮廓、各段长宽比例、连接结构、颜色、既有标识、数量和物件相对位置保持一致。未明确要求改动的部分不重设计、不换视角；画幅变化只调整背景和留白，主体只等比缩放。'
      : reference
        ? '以参考图中主体既有外观及物件相对位置为依据，只修改明确要求的部分，不凭文字补造未见细节。'
        : '';
  const imagePrompt = exactPan
    ? '原参考图作为本机静态图运镜的源图；不调用图片模型，不将裁切后的取景画面声称为未改动的原图首帧。'
    : [plan.imagePrompt, preserve, '只生成单张初始定格画面，不生成分镜拼图，不添加文字或水印。']
        .filter(Boolean)
        .join('\n\n');
  const controlledMotion =
    plan.cameraControl?.type === 'translate'
      ? `将提供的静态首帧视为一张完整平面画布，仅做二维水平滑动：整幅画面向${plan.cameraControl.direction === 'right' ? '左' : '右'}平移约画面宽度的${plan.cameraControl.displacementPercent}%到提供的尾帧。背景、台面、全部物件及阴影以同一位移同步移动；各处轮廓、比例、倾角、遮挡和背景分界形状保持不变，不生成视差、三维新视角或绕拍，不旋转、不缩放、不让物件或部件自行移动。单向平滑滑动，无反向或过冲；结束前约0.5秒停稳在尾帧。`
      : plan.cameraControl?.type === 'zoom'
        ? `将提供的静态首帧视为一张完整平面画布，仅围绕固定画面中心做二维等比放大，终点严格为首帧尺寸的${plan.cameraControl.scalePercent}%，到达提供的尾帧。背景、台面、全部物件及阴影使用同一中心和缩放比例同步放大；各处形状、倾角、遮挡和相对位置关系保持一致，不生成视差、三维新视角或物件运动，不横移、不旋转、不超出尾帧尺度。单向平滑放大，无反向或过冲；结束前约0.5秒停稳在尾帧。`
        : '';
  const videoPrompt = exactPan
    ? `使用本机精确平移合成。源图先等比放大约${exactPan.displacementPercent}%以预留取景余量，仅裁切已允许的边缘背景，不镜像或补画边缘。固定取景窗口向${exactPan.direction === 'right' ? '右' : '左'}移动，整幅画面相对窗口向${exactPan.direction === 'right' ? '左' : '右'}平移约画宽${exactPan.displacementPercent}%；全部主体、部件、背景和阴影保持同一几何关系，不重绘、不改变视角。平滑开始与结束，最后0.5秒停稳；不调用视频模型。`
    : [
        plan.cameraControl ? '' : plan.videoPrompt,
        // The endpoint is a 2D translation of the same image. Asking for a physical
        // camera move introduced parallax and changed cap geometry between endpoints.
        controlledMotion,
        plan.cameraControl
          ? `只执行上述整幅${plan.cameraControl.type === 'zoom' ? '等比放大' : '平移'}，保持首帧中的主体、数量、结构、相对位置和场景；不重设计主体或增加物件，不添加字幕或水印。`
          : '提供的首帧确定初始主体、数量、结构、相对位置和场景。只执行上述明确的动作与镜头变化，其余保持连续；不擅自重设计主体或增加物件，不添加字幕或水印。',
      ]
        .filter(Boolean)
        .join('\n\n');
  return {
    imagePrompt,
    videoPrompt,
    ...(plan.firstFrame ? { firstFrame: plan.firstFrame } : {}),
    ...(plan.cameraControl ? { cameraControl: plan.cameraControl } : {}),
    ...(usesExactPan(result, request) ? { motionRenderer: 'exact-pan-v1' as const } : {}),
    ...(usesModelVideoTailHold(result, request)
      ? { videoPostprocess: 'model-video-tail-hold-v1' as const }
      : {}),
  };
}
