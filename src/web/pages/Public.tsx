import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LockKeyhole, Users } from 'lucide-react';
import type { SceneDocumentV1 } from '../../contracts/scene';
import { api, post } from '../lib/api';
import { Button, ErrorState, Loading, Notice, useAction } from '../components/ui';
import { CanvasEditor } from '../editor/CanvasEditor';
import type { ExportPolicy } from '../../contracts/export-policy';
import type { EditorAsset } from '../editor/types';
import { useStudio } from '../context';
interface SharedDocument {
  exportPolicy: ExportPolicy;
  project: { name: string; description: string };
  document: { name: string; scene: SceneDocumentV1; revision: number };
  assetIds: string[];
  allowOriginalDownload: boolean;
  assets: {
    id: string;
    name: string;
    kind: EditorAsset['kind'];
    width: number | null;
    height: number | null;
    previewVariant: 'preview' | 'thumbnail' | null;
    previewMimeType: string | null;
    originalAvailable: boolean;
  }[];
}
export function PublicShare() {
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const [data, setData] = useState<SharedDocument | null>(null);
  const [assets, setAssets] = useState<EditorAsset[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let disposed = false;
    const urls: string[] = [];
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        if (!token) throw new Error('分享链接缺少访问令牌。');
        const result = await api<SharedDocument>(
          '/public/shares/read',
          { method: 'POST', body: JSON.stringify({ token }), signal: controller.signal },
          null,
        );
        const resolved = await Promise.all(
          result.assets.map(async (asset) => {
            const variant = asset.originalAvailable ? 'original' : asset.previewVariant;
            if (!variant) return null;
            const response = await fetch('/api/v1/public/shares/asset', {
              method: 'POST',
              signal: controller.signal,
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ token, assetId: asset.id, variant }),
            });
            if (!response.ok) throw new Error('部分分享素材不可用，可能已撤销或过期。');
            const blob = await response.blob();
            if (disposed) return null;
            const url = URL.createObjectURL(blob);
            urls.push(url);
            return {
              id: asset.id,
              name: asset.name,
              kind: asset.kind,
              width: asset.width,
              height: asset.height,
              originalAvailable: asset.originalAvailable,
              playable:
                !['video', 'audio'].includes(asset.kind) || blob.type.startsWith(`${asset.kind}/`),
              originalUrl:
                ['video', 'audio'].includes(asset.kind) && !blob.type.startsWith(`${asset.kind}/`)
                  ? ''
                  : url,
              previewUrl: url,
              ...(blob.type.startsWith('image/') && asset.kind !== 'image'
                ? { thumbnailUrl: url }
                : {}),
            } as EditorAsset;
          }),
        );
        if (!disposed) {
          setData(result);
          setAssets(resolved.filter((asset): asset is EditorAsset => !!asset));
        }
      } catch (err) {
        if (!disposed) setError(err);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      controller.abort();
      urls.forEach(URL.revokeObjectURL);
    };
  }, [token]);
  return (
    <div className="public-share">
      <header>
        <Link className="wordmark" to="/">
          <span className="brand-mark">{t('映')}</span>
          <strong>
            {t('映造')}
            <span>Studio</span>
          </strong>
        </Link>
        <span>
          <LockKeyhole size={15} />
          {t('只读分享')}
        </span>
      </header>
      {loading ? (
        <Loading label={t('正在加载分享内容…')} />
      ) : error ? (
        <ErrorState error={error} />
      ) : (
        data && (
          <>
            <div className="public-share-heading">
              <h1>{data.project.name}</h1>
              <p>{data.project.description}</p>
            </div>
            {!data.allowOriginalDownload && (
              <Notice>{t('此链接只提供预览，原件下载已关闭；预览仍可能被截图或保存。')}</Notice>
            )}
            {data.assets.some((asset) => !asset.previewVariant && !asset.originalAvailable) && (
              <Notice tone="warning">
                {t('部分素材没有可用预览，且未授权下载原件，因此无法播放或显示。')}
              </Notice>
            )}
            <CanvasEditor
              exportPolicy={data.exportPolicy}
              resolveExportPolicy={async () => {
                const refreshed = await api<SharedDocument>(
                  '/public/shares/read',
                  { method: 'POST', body: JSON.stringify({ token }) },
                  null,
                );
                return refreshed.exportPolicy;
              }}
              scene={data.document.scene}
              assets={assets}
              onChange={() => undefined}
              readOnly
              allowOriginalDownload={data.allowOriginalDownload}
            />
          </>
        )
      )}
    </div>
  );
}
export function InvitePage() {
  const { session, refreshSession, switchWorkspace } = useStudio();
  const token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
  const action = useAction();
  const navigate = useNavigate();
  return (
    <div className="invite-page">
      <div className="panel settings-panel">
        <span className="feature-symbol">
          <Users size={30} />
        </span>
        <h1>{t('加入一个新的创作团队')}</h1>
        <p className="muted">
          {t('当前账户：')}
          {session?.user.email}
        </p>
        <Notice>{t('邀请只能由指定邮箱使用。成功加入后，团队资料会独立于你的个人空间。')}</Notice>
        <Button
          disabled={!token}
          busy={action.busy}
          onClick={() =>
            void action.run(async () => {
              const result = await post<{ workspace: { id: string } }>('/invitations/accept', {
                token,
              });
              await refreshSession();
              await switchWorkspace(result.workspace.id);
              navigate('/team');
            }, '已加入团队')
          }
        >
          {t('接受邀请并进入团队')}
        </Button>
        <Link className="text-button" to="/">
          {t('返回工作空间')}
        </Link>
      </div>
    </div>
  );
}
