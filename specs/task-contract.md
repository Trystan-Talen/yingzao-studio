# 任务与供应商契约 v1

与backend-contract同样包装与空间头。共享类型最终在src/contracts/jobs.ts。

- GET /capabilities → {providers:[{id,name,configured,capabilities}],operations:[{id,name,providerId,available,reason,models,priceCredits,unit}]}；无secret。
- POST /quotes 输入 JobInput → Quote {id,inputHash,pricingVersion,maxCredits,expiresAt,providerId,operation,units}。
- POST /jobs 输入 {input:JobInput,quoteId,clientRequestId} → JobDto；input hash不一致409。GET /jobs标准列表、GET /jobs/:id→JobDto，GET /jobs/:id/events标准列表；GET /events持久SSE支持Last-Event-ID。
- POST /jobs/:id/cancel /retry （retry要新quote以及requestId，复制失败项）；POST /jobs/:id/reconcile 仅admin且明确远端结果，不能自由status写成功。
- GET /credits→{balance,reserved,available,spent,isDemo,unit:"credits"}；GET /credits/ledger标准分页。
- GET/PUT /provider-settings：空间admin获取配置状态和更新密钥（密钥字段响应永不返回）；providerId明确，endpoint固定官方或用户显式配置的合法HTTPS域名；加密保存。
- GET /pending-applies?documentId；POST /pending-applies/:id/apply 输入 {expectedRevision,mode:new-layer|replace,layerId?}；POST /pending-applies/:id/dismiss。

JobInput字段：operation（image.generate/video.generate/工具ID/local.resize/local.convert/local.stitch/local.video-trim）、providerId(local/flyelep/openai)、projectId可选、documentId/baseRevision/targetLayerId可选、prompt、assetIds、referenceAssetIds、maskAssetId可选、brandId可选、options {model,kind,ratio,count,resolution,duration,language,platform,channel,needText,referenceMode,scale,strength,colors,background,width,height,format,trimStart,trimEnd,sellingPoints,price,replacementType,keepMusicRhythm}。只允许相应operation使用的参数；不透传任意URL/任意API路径。

JobDto {id,workspaceId,projectId,operation,providerId,prompt,status,stage,requestedCredits,settledCredits,createdAt,updatedAt,errorMessage,items:[{id,index,status,assetId,remoteId,errorMessage}],outputAssets:AssetDto[]}。状态 queued/running/succeeded/partial/failed/cancelled/reconciliation_required。百分比仅供应商真实给出才显示，否则阶段文字。

provider接口按 execute/sync 或 submit+poll 分开，throw ProviderError {retrySafe,ambiguous,code,message}。没有安全证据的网络提交错误默认ambiguous。服务端输出Buffer或者URL由安全下载器转Buffer，验证真实文件后统一入库。URL不能指向私网/loopback，重定向逐跳验证，限大小/时间；凭据只发送固定provider origin，绝不随redirect转发。

local操作单独标为确定性处理，不叫AI。模型适配器测试fixture只能自动测试使用，不注册到生产capabilities。原站文档没有洗图/完整视频查询的情况诚实标协议未完整，需要可验证替代服务；预占前阻止。
