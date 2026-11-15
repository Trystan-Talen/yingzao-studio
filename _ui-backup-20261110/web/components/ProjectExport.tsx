import { useEffect, useRef, useState } from 'react';
import type { AssetDto, ProjectDto } from '../../contracts/core';
import type { ExportPolicy } from '../../contracts/export-policy';
import { getSceneAssetIds, type SceneDocumentV1 } from '../../contracts/scene';
import type { Job } from '../lib/tasks';
import type { ExportBoard } from '../editor/types';
import { api, useApi, type Page } from '../lib/api';
import { useStudio } from '../context';
import { t } from '../lib/i18n';
import { Button, Field, Modal, Notice, useAction } from './ui';
export function ProjectExport({
  projects,
  onClose,
}: {
  projects: ProjectDto[];
  onClose: () => void;
}) {
  const { workspace } = useStudio();
  const exportPolicy = useApi<ExportPolicy>('/export-policy');
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [scale, setScale] = useState(1);
  const [transparent, setTransparent] = useState(false);
  const [provenance, setProvenance] = useState(true);
  const [stage, setStage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const action = useAction();
  useEffect(() => () => controller.current?.abort(), []);
  async function exportProjects() {
    await action.run(async () => {
      const workspaceId = workspace?.id ?? null;
      const abort = new AbortController();
      controller.current = abort;
      const boards: ExportBoard[] = [];
      const assets = new Map<string, AssetDto>();
      let pixels = 0;
      try {
        const policy = await api<ExportPolicy>(
          '/export-policy',
          { signal: abort.signal },
          workspaceId,
        );
        for (const project of projects) {
          setStage(`${t('读取画布')} · ${project.name}`);
          const doc = await api<{
            id: string;
            name: string;
            revision: number;
            scene: SceneDocumentV1;
          }>(`/projects/${project.id}/document`, { signal: abort.signal }, workspaceId);
          pixels += doc.scene.canvas.width * doc.scene.canvas.height * scale * scale;
          if (pixels > 100_000_000)
            throw new Error(t('所选画布导出总像素超过 1 亿，请减少项目或降低倍率。'));
          const jobs = provenance
            ? await api<Page<Job>>(
                `/jobs?projectId=${project.id}&pageSize=100`,
                { signal: abort.signal },
                workspaceId,
              )
            : null;
          boards.push({
            id: doc.id,
            name: project.name,
            scene: doc.scene,
            metadata: {
              documentId: doc.id,
              revision: doc.revision,
              sourceJobs: jobs?.items.map((job) => ({
                id: job.id,
                operation: job.operation,
                providerId: job.providerId,
                parameters: job.input,
              })),
            },
          });
          for (const id of getSceneAssetIds(doc.scene)) {
            if (assets.has(id)) continue;
            assets.set(
              id,
              await api<AssetDto>(`/assets/${id}`, { signal: abort.signal }, workspaceId),
            );
          }
        }
        if (
          [...assets.values()].reduce((sum, asset) => sum + asset.byteSize, 0) >
          250 * 1024 * 1024
        )
          throw new Error(t('所选画布素材超过 250 MB，请分批导出。'));
        setStage(t('正在渲染并打包画布…'));
        const { exportSceneBundle } = await import('../editor/CanvasEditor');
        const blob = await exportSceneBundle(boards, [...assets.values()], {
          format,
          scale,
          transparent: format === 'png' && transparent,
          signal: abort.signal,
          includeProvenance: provenance,
          policy,
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'yingzao-project-boards.zip';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        onClose();
      } finally {
        setStage('');
      }
    }, '项目画布已打包下载');
  }
  return (
    <Modal
      open
      onClose={() => {
        if (!action.busy) onClose();
      }}
      title={t('批量导出项目画布')}
      description={t('导出各项目当前已保存的画布，并提供可选的来源参数清单。')}
    >
      <p>
        {projects.length} {t('个项目')}
      </p>
      <ul>
        {projects.map((project) => (
          <li key={project.id}>{project.name}</li>
        ))}
      </ul>
      <div className="form-grid">
        <Field label={t('文件格式')}>
          <select
            disabled={action.busy}
            value={format}
            onChange={(e) => setFormat(e.target.value as 'png' | 'jpeg')}
          >
            <option value="png">PNG</option>
            <option value="jpeg">JPG</option>
          </select>
        </Field>
        <Field label={t('导出倍率')}>
          <select
            disabled={action.busy}
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
          >
            {[1, 2, 3].map((value) => (
              <option key={value} value={value}>
                {value}×
              </option>
            ))}
          </select>
        </Field>
      </div>
      {format === 'png' && (
        <label className="checkbox-label">
          <input
            disabled={action.busy}
            type="checkbox"
            checked={transparent}
            onChange={(e) => setTransparent(e.target.checked)}
          />
          {t('透明背景')}
        </label>
      )}
      <label className="checkbox-label">
        <input
          disabled={action.busy}
          type="checkbox"
          checked={provenance}
          onChange={(e) => setProvenance(e.target.checked)}
        />
        {t('包含 AI 参数与来源清单')}
      </label>
      <Notice>
        {t(
          '每次最多 20 个项目，总导出像素不超过 1 亿。视频原件请从素材库下载，画布导出保留当前静态构图。',
        )}
      </Notice>
      <Notice>
        {exportPolicy.data?.watermark
          ? t('此空间的应用导出会添加水印，导出时将重新核对当前策略。')
          : t('导出时会重新核对当前水印策略；策略读取失败时不会继续下载。')}
      </Notice>
      {stage && <p role="status">{stage}</p>}
      <div className="modal-actions">
        {action.busy ? (
          <Button variant="secondary" onClick={() => controller.current?.abort()}>
            {t('取消导出')}
          </Button>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            {t('取消')}
          </Button>
        )}
        <Button busy={action.busy} onClick={() => void exportProjects()}>
          {t('导出 ZIP')}
        </Button>
      </div>
    </Modal>
  );
}
