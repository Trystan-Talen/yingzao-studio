// Isolated audit probes: no database, media writes, real credentials or network calls.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const crypto = require('node:crypto');
const platformRoot = path.resolve(__dirname, '../../../platform');
const projectRequire = Module.createRequire(path.join(platformRoot, 'package.json'));
const ts = projectRequire('typescript');
require.extensions['.ts'] = (mod, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, filename);
};
const originalLoad = Module._load;
Module._load = function (specifier, ...args) {
  if (specifier === 'sharp') return () => { throw new Error('Probe must not process image bytes'); };
  return originalLoad.call(this, specifier, ...args);
};
const { jobInputSchema } = require(path.join(platformRoot, 'src/contracts/jobs.ts'));
const { splitItems, validateInput } = require(path.join(platformRoot, 'src/server/tasks/validation.ts'));
const { flyelepProvider } = require(path.join(platformRoot, 'src/server/providers/flyelep.ts'));
const { openaiProvider } = require(path.join(platformRoot, 'src/server/providers/openai.ts'));
const { falProvider } = require(path.join(platformRoot, 'src/server/providers/fal.ts'));
const noRead = async () => { throw new Error('Probe must not read media'); };
const context = input => ({ actor: {}, workspaceId: 'audit-fixture', input, readAsset: noRead });
(async () => {
  const results = [];
  const ids = Array.from({ length: 4 }, () => crypto.randomUUID());
  const replacement = jobInputSchema.parse({ operation: 'product-replace', providerId: 'flyelep',
    assetIds: ids.slice(0, 2), referenceAssetIds: ids.slice(2), prompt: '替换产品', options: { model: '9' } });
  const items = splitItems(replacement);
  let captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ code: 200, result: { fileUrlList: ['https://example.com/result.png'] } }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  };
  for (const item of items) await flyelepProvider.execute({ ...context(item),
    assetUrl: id => `https://example.com/${id}` }, 'audit-fixture-secret');
  results.push({ probe: 'product-replacement-two-sources-two-references', items: items.length,
    requestedReferences: 2, uniqueReplacementUrls: new Set(captured.map(x => x.replaceImageUrl)).size,
    secondReferenceUsed: captured.some(x => JSON.stringify(x).includes(ids[3])) });
  const emptyPlan = { analysis: '', objective: '', style: '', palette: [], composition: '', copy: [], scene: '',
    technical: { ratio: '', resolution: '', language: '' }, directions: Array.from({ length: 3 }, () => ({ title: '', prompt: '' })) };
  globalThis.fetch = async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [
    { type: 'output_text', text: JSON.stringify(emptyPlan) }] }] }), { status: 200 });
  const plan = await openaiProvider.execute(context(jobInputSchema.parse({ operation: 'text.assist',
    providerId: 'openai', prompt: '设计方案', options: { assistantMode: 'design-plan' } })), 'audit-fixture-secret');
  results.push({ probe: 'blank-design-plan-with-three-directions', state: plan.state,
    nonEmptyOutput: plan.state === 'complete' && Boolean(plan.outputs[0].text.trim()) });
  captured = [];
  globalThis.fetch = async (_url, init) => {
    captured.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ request_id: 'audit-fixture', status_url: 'https://queue.fal.run/status',
      response_url: 'https://queue.fal.run/result' }), { status: 200 });
  };
  for (const options of [{ needText: true, language: 'zh-CN' }, { needText: false, language: 'en' }])
    await falProvider.execute(context(jobInputSchema.parse({ operation: 'video.generate', providerId: 'fal',
      prompt: '展示商品', options: { model: 'wan-2.6', resolution: '720p', ...options } })), 'audit-fixture-secret');
  results.push({ probe: 'video-language-and-captions',
    differentSettingsProduceIdenticalRequest: JSON.stringify(captured[0]) === JSON.stringify(captured[1]) });
  const asset = { id: crypto.randomUUID(), kind: 'image', mimeType: 'image/png', width: 4000, height: 4000, byteSize: 1000000 };
  const core = { requireAccess: () => {}, assets: { get: () => asset } };
  const settings = { validateCapability: () => ({}) };
  const upscale = validateInput(core, settings, { authType: 'session' }, 'audit-fixture', {
    operation: 'image-upscale', providerId: 'fal', assetIds: [asset.id], options: { model: 'aura-sr', scale: 4 } });
  results.push({ probe: 'upscale-output-preflight', inputAccepted: true,
    predictedOutputPixels: asset.width * asset.height * upscale.options.scale ** 2, storageMaxPixels: 64000000 });
  const recolor = jobInputSchema.parse({ operation: 'product-recolor', providerId: 'openai',
    assetIds: [asset.id], options: { colors: ['#ffffff', '#ffffff'] } });
  results.push({ probe: 'duplicate-colors', outputCount: splitItems(recolor).length,
    distinctColors: new Set(recolor.options.colors).size });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), mode: 'isolated-in-memory',
    realNetworkCalls: 0, databaseAccess: false, mediaProcessing: false, results }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
