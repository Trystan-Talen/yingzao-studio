import { t } from '../lib/i18n';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ActiveSelection, Canvas, Point, Rect, Textbox } from 'fabric';
import {
  Circle,
  Download,
  Expand,
  Group,
  Hand,
  ImagePlus,
  Layers,
  LoaderCircle,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  SlidersHorizontal,
  Square,
  Type,
  Undo2,
  Ungroup,
  Upload,
  X,
} from 'lucide-react';
import {
  sceneDocumentSchema,
  type SceneDocumentV1,
  type SceneLayer,
} from '../../contracts/scene.js';
import {
  createSceneObjects,
  downloadBlob,
  exportScene,
  objectLayerId,
  readObjectLayer,
} from './fabric-adapter.js';
import {
  alignLayers,
  cloneLayer,
  groupLayers,
  layerBase,
  layerFromAsset,
  reorderLayer,
  ungroupLayer,
} from './scene-operations.js';
import { LayerPanel } from './LayerPanel.js';
import { PropertiesPanel } from './PropertiesPanel.js';
import { exportSceneBundle } from './export-bundle';
import type { CanvasEditorProps, EditorAsset } from './types.js';
import './editor.css';

export type { CanvasEditorProps, EditorAsset, ExportBoard, ExportMetadata } from './types.js';
export { exportSceneBundle } from './export-bundle';

const historyLimit = 80;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || !!target.closest('input,textarea,select,[role="textbox"]'))
  );
}

export function CanvasEditor({
  scene,
  onChange,
  assets,
  onUpload,
  readOnly = false,
  allowOriginalDownload = true,
  exportPolicy,
  resolveExportPolicy,
  exportMetadata,
  exportBoards = [],
}: CanvasEditorProps) {
  const [current, setCurrent] = useState(scene);
  const editorId = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mobilePanel, setMobilePanel] = useState<'canvas' | 'layers' | 'properties'>('canvas');
  const [panel, setPanel] = useState<'layers' | 'properties'>('layers');
  const [panMode, setPanMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [mediaWarnings, setMediaWarnings] = useState<string[]>([]);
  const [dialog, setDialog] = useState<'assets' | 'export' | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadAssets, setUploadAssets] = useState<EditorAsset[]>([]);
  const [assetQuery, setAssetQuery] = useState('');
  const [exportFormat, setExportFormat] = useState<'png' | 'jpeg'>('png');
  const [exportScale, setExportScale] = useState(1);
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportScope, setExportScope] = useState<
    'canvas' | 'selection' | 'layers-zip' | 'boards-zip'
  >('canvas');
  const [includeProvenance, setIncludeProvenance] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const elementRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<Canvas | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentRef = useRef(current);
  const selectedRef = useRef(selectedIds);
  const callbackRef = useRef(onChange);
  const readonlyRef = useRef(readOnly);
  const panRef = useRef(panMode);
  const muteSelection = useRef(false);
  const history = useRef<{ past: SceneDocumentV1[]; future: SceneDocumentV1[] }>({
    past: [],
    future: [],
  });
  const lastEmission = useRef<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  const renderRelease = useRef<(() => void) | null>(null);
  currentRef.current = current;
  selectedRef.current = selectedIds;
  callbackRef.current = onChange;
  readonlyRef.current = readOnly;
  panRef.current = panMode;

  const allAssets = [
    ...new Map([...assets, ...uploadAssets].map((asset) => [asset.id, asset])).values(),
  ];
  const assetsRef = useRef(allAssets);
  assetsRef.current = allAssets;
  const assetsSignature = JSON.stringify(
    allAssets.map((asset) => [
      asset.id,
      asset.originalUrl,
      asset.width,
      asset.height,
      asset.durationMs,
    ]),
  );

  const commit = useCallback((next: SceneDocumentV1, keepHistory = true) => {
    if (readonlyRef.current) return;
    const parsed = sceneDocumentSchema.safeParse(next);
    if (!parsed.success) {
      setNotice(parsed.error.issues[0]?.message ?? t('画布内容不符合保存规范。'));
      return;
    }
    if (JSON.stringify(parsed.data) === JSON.stringify(currentRef.current)) return;
    if (keepHistory) {
      history.current.past = [
        ...history.current.past.slice(-(historyLimit - 1)),
        currentRef.current,
      ];
      history.current.future = [];
    }
    currentRef.current = parsed.data;
    lastEmission.current = JSON.stringify(parsed.data);
    setCurrent(parsed.data);
    setHistoryVersion((version) => version + 1);
    callbackRef.current(parsed.data);
  }, []);

  useEffect(() => {
    const incoming = JSON.stringify(scene);
    if (incoming === JSON.stringify(currentRef.current) || incoming === lastEmission.current)
      return;
    // Restored revisions and another project are deliberate external replacements.
    history.current = { past: [], future: [] };
    setSelectedIds([]);
    currentRef.current = scene;
    setCurrent(scene);
    setHistoryVersion((version) => version + 1);
  }, [scene]);

  const undo = useCallback(() => {
    const previous = history.current.past.pop();
    if (!previous || readonlyRef.current) return;
    history.current.future.push(currentRef.current);
    commit(previous, false);
  }, [commit]);
  const redo = useCallback(() => {
    const next = history.current.future.pop();
    if (!next || readonlyRef.current) return;
    history.current.past.push(currentRef.current);
    commit(next, false);
  }, [commit]);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const { width, height } = currentRef.current.canvas;
    const nextZoom = Math.max(
      0.02,
      Math.min((host.clientWidth - 48) / width, (host.clientHeight - 48) / height, 1),
    );
    canvas.setViewportTransform([
      nextZoom,
      0,
      0,
      nextZoom,
      (host.clientWidth - width * nextZoom) / 2,
      (host.clientHeight - height * nextZoom) / 2,
    ]);
    canvas.requestRenderAll();
    setZoom(nextZoom);
  }, []);

  const setSelectionOnCanvas = useCallback((ids: string[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    muteSelection.current = true;
    canvas.discardActiveObject();
    const objects = canvas.getObjects().filter((object) => {
      const id = objectLayerId(object);
      return !!id && ids.includes(id) && object.selectable && object.visible;
    });
    if (objects.length === 1 && objects[0]) canvas.setActiveObject(objects[0]);
    else if (objects.length > 1)
      canvas.setActiveObject(
        new ActiveSelection(objects, { canvas, originX: 'left', originY: 'top' }),
      );
    canvas.requestRenderAll();
    muteSelection.current = false;
  }, []);

  useEffect(() => {
    const element = elementRef.current;
    const host = hostRef.current;
    if (!element || !host) return;
    const canvas = new Canvas(element, {
      width: host.clientWidth,
      height: host.clientHeight,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
      selectionColor: 'rgba(66,104,86,0.10)',
      selectionBorderColor: '#426856',
      uniformScaling: false,
    });
    canvasRef.current = canvas;
    let drag: { x: number; y: number } | null = null;
    const updateSelection = () => {
      if (muteSelection.current) return;
      const ids = canvas.getActiveObjects().flatMap((object) => {
        const id = objectLayerId(object);
        return id ? [id] : [];
      });
      setSelectedIds(ids);
    };
    const commitObjects = () => {
      if (readonlyRef.current) return;
      const selected = [...selectedRef.current];
      const multiple = canvas.getActiveObject() instanceof ActiveSelection;
      // Fabric resolves the active-selection transform back into each object's
      // own plane, including stroke origins and skew, before persistence.
      if (multiple) {
        muteSelection.current = true;
        canvas.discardActiveObject();
        muteSelection.current = false;
      }
      const layers = canvas.getObjects().flatMap((object) => {
        const layer = readObjectLayer(object);
        return layer ? [layer] : [];
      });
      commit({ ...currentRef.current, layers });
      if (multiple) setSelectionOnCanvas(selected);
    };
    canvas.on('selection:created', updateSelection);
    canvas.on('selection:updated', updateSelection);
    canvas.on('selection:cleared', updateSelection);
    canvas.on('object:modified', commitObjects);
    canvas.on('text:editing:exited', commitObjects);
    canvas.on('mouse:down', ({ e }) => {
      if (!(e instanceof MouseEvent || e instanceof PointerEvent)) return;
      if (panRef.current || e.altKey || e.button === 1) {
        drag = { x: e.clientX, y: e.clientY };
        canvas.selection = false;
        canvas.skipTargetFind = true;
        canvas.setCursor('grabbing');
      }
    });
    canvas.on('mouse:move', ({ e }) => {
      if (!drag || !(e instanceof MouseEvent || e instanceof PointerEvent)) return;
      canvas.relativePan(new Point(e.clientX - drag.x, e.clientY - drag.y));
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.on('mouse:up', () => {
      drag = null;
      canvas.selection = !readonlyRef.current && !panRef.current;
      canvas.skipTargetFind = panRef.current;
      canvas.setCursor(panRef.current ? 'grab' : 'default');
      canvas.setViewportTransform(canvas.viewportTransform);
    });
    canvas.on('mouse:wheel', ({ e }) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        const next = Math.min(4, Math.max(0.02, canvas.getZoom() * 0.998 ** e.deltaY));
        canvas.zoomToPoint(new Point(e.offsetX, e.offsetY), next);
        setZoom(next);
      } else canvas.relativePan(new Point(-e.deltaX, -e.deltaY));
    });
    const resize = new ResizeObserver(() => {
      if (!host.clientWidth || !host.clientHeight) return;
      canvas.setDimensions({ width: host.clientWidth, height: host.clientHeight });
      fit();
    });
    resize.observe(host);
    fit();
    return () => {
      resize.disconnect();
      canvasRef.current = null;
      renderRelease.current?.();
      renderRelease.current = null;
      void canvas.dispose();
      exportController.current?.abort();
    };
  }, [commit, fit, setSelectionOnCanvas]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.selection = !readOnly && !panMode;
    canvas.skipTargetFind = panMode;
    canvas.defaultCursor = panMode ? 'grab' : 'default';
  }, [readOnly, panMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    setLoading(true);
    void createSceneObjects(current, assetsRef.current, { signal: controller.signal, readOnly })
      .then((rendered) => {
        if (controller.signal.aborted) {
          rendered.objects.forEach((object) => object.dispose());
          rendered.release();
          return;
        }
        muteSelection.current = true;
        canvas.discardActiveObject();
        for (const old of canvas.getObjects()) {
          canvas.remove(old);
          old.dispose();
        }
        renderRelease.current?.();
        renderRelease.current = rendered.release;
        const background = new Rect({
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          width: current.canvas.width,
          height: current.canvas.height,
          fill: current.canvas.background === 'transparent' ? '#FFFFFF' : current.canvas.background,
          strokeWidth: 0,
          selectable: false,
          evented: false,
          excludeFromExport: true,
        });
        canvas.add(background, ...rendered.objects);
        muteSelection.current = false;
        setSelectionOnCanvas(selectedRef.current);
        canvas.requestRenderAll();
        setMediaWarnings(rendered.failures);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setNotice(error instanceof Error ? error.message : t('画布加载失败。'));
          setLoading(false);
        }
      });
    return () => {
      controller.abort();
    };
  }, [current, assetsSignature, readOnly, setSelectionOnCanvas]);

  useEffect(() => {
    fit();
  }, [current.canvas.width, current.canvas.height, fit]);

  const selectLayer = (id: string, multiple: boolean) => {
    const next = multiple
      ? selectedIds.includes(id)
        ? selectedIds.filter((item) => item !== id)
        : [...selectedIds, id]
      : [id];
    setSelectedIds(next);
    setSelectionOnCanvas(next);
  };

  const patchLayer = useCallback(
    (id: string, patch: Partial<SceneLayer>) => {
      commit({
        ...currentRef.current,
        layers: currentRef.current.layers.map((layer) =>
          layer.id === id ? ({ ...layer, ...patch } as SceneLayer) : layer,
        ),
      });
    },
    [commit],
  );

  const removeLayers = useCallback(
    (ids: string[]) => {
      commit({
        ...currentRef.current,
        layers: currentRef.current.layers.filter(
          (layer) => !ids.includes(layer.id) || layer.locked,
        ),
      });
      setSelectedIds([]);
    },
    [commit],
  );

  const duplicateLayers = useCallback(
    (ids: string[]) => {
      const copies = currentRef.current.layers
        .filter((layer) => ids.includes(layer.id) && !layer.locked)
        .map((layer) => ({
          ...cloneLayer(layer),
          name: `${layer.name} ${t('副本')}`.slice(0, 160),
          x: layer.x + 24,
          y: layer.y + 24,
        }));
      if (!copies.length) return;
      commit({ ...currentRef.current, layers: [...currentRef.current.layers, ...copies] });
      setSelectedIds(copies.map((layer) => layer.id));
    },
    [commit],
  );

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        readonlyRef.current ||
        isTyping(event.target) ||
        (canvasRef.current?.getActiveObject() instanceof Textbox &&
          (canvasRef.current.getActiveObject() as Textbox).isEditing)
      )
        return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (command && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (command && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateLayers(selectedRef.current);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeLayers(selectedRef.current);
      } else if (
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) &&
        selectedRef.current.length
      ) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        commit({
          ...currentRef.current,
          layers: currentRef.current.layers.map((layer) =>
            !selectedRef.current.includes(layer.id) || layer.locked
              ? layer
              : {
                  ...layer,
                  x:
                    layer.x +
                    (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0),
                  y:
                    layer.y +
                    (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0),
                },
          ),
        });
      }
    };
    root.addEventListener('keydown', keydown);
    return () => root.removeEventListener('keydown', keydown);
  }, [undo, redo, commit, removeLayers, duplicateLayers]);

  const addLayer = (layer: SceneLayer) => {
    commit({ ...currentRef.current, layers: [...currentRef.current.layers, layer] });
    setSelectedIds([layer.id]);
    setPanel('properties');
    setMobilePanel('canvas');
    setNotice('');
  };

  const addAsset = (asset: EditorAsset) => {
    try {
      addLayer(layerFromAsset(asset, currentRef.current));
      setDialog(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('素材无法加入画布。'));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file || !onUpload || readOnly || uploading) return;
    setUploading(true);
    setNotice('');
    try {
      const asset = await onUpload(file);
      setUploadAssets((previous) => [...previous.filter((item) => item.id !== asset.id), asset]);
      addAsset(asset);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('上传失败，请重试。'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runExport = async () => {
    if (exporting || !allowOriginalDownload) return;
    exportController.current?.abort();
    const controller = new AbortController();
    exportController.current = controller;
    setExporting(true);
    setNotice('');
    try {
      const policy = resolveExportPolicy ? await resolveExportPolicy() : exportPolicy;
      if (controller.signal.aborted) return;
      const scene = currentRef.current;
      const selection = selectedRef.current.filter((id) =>
        scene.layers.some((layer) => layer.id === id && layer.visible),
      );
      if ((exportScope === 'selection' || exportScope === 'layers-zip') && !selection.length)
        throw new Error(t('请先选择可见图层。'));
      const options = {
        format: exportFormat,
        policy,
        scale: exportScale,
        transparent: exportTransparent,
        signal: controller.signal,
      };
      let blob: Blob;
      let fileName: string;
      if (includeProvenance || exportScope.endsWith('-zip')) {
        const boards =
          exportScope === 'boards-zip'
            ? exportBoards
            : exportScope === 'layers-zip'
              ? selection.map((id) => ({
                  id,
                  name: scene.layers.find((layer) => layer.id === id)!.name,
                  scene,
                  layerIds: [id],
                  metadata: exportMetadata,
                }))
              : [
                  {
                    id: exportMetadata?.documentId || 'current-canvas',
                    name: t('映造作品'),
                    scene,
                    metadata: exportMetadata,
                    ...(exportScope === 'selection' ? { layerIds: selection } : {}),
                  },
                ];
        blob = await exportSceneBundle(boards, assetsRef.current, {
          ...options,
          includeProvenance,
        });
        fileName = `${t('映造作品')}.zip`;
      } else {
        let size = { width: scene.canvas.width, height: scene.canvas.height };
        blob = await exportScene(scene, assetsRef.current, {
          ...options,
          ...(exportScope === 'selection' ? { layerIds: selection } : {}),
          onDimensions: (dimensions) => {
            size = dimensions;
          },
        });
        fileName = `${t('映造作品')}-${size.width}x${size.height}.${exportFormat === 'jpeg' ? 'jpg' : 'png'}`;
      }
      if (controller.signal.aborted) return;
      downloadBlob(blob, fileName);
      setDialog(null);
      setNotice(t('图片已生成，浏览器已开始下载。'));
    } catch (error) {
      if (!controller.signal.aborted)
        setNotice(error instanceof Error ? error.message : t('导出失败，请检查素材。'));
    } finally {
      setExporting(false);
    }
  };

  const changeZoom = (multiplier: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next = Math.min(4, Math.max(0.02, canvas.getZoom() * multiplier));
    canvas.zoomToPoint(new Point(canvas.width / 2, canvas.height / 2), next);
    setZoom(next);
  };
  const selectedLayer =
    selectedIds.length === 1
      ? current.layers.find((layer) => layer.id === selectedIds[0])
      : undefined;
  const canGroup =
    current.layers.filter((layer) => selectedIds.includes(layer.id) && !layer.locked).length > 1;
  const chooseGroup = () => {
    const result = groupLayers(currentRef.current, selectedRef.current);
    if (result) {
      commit(result.scene);
      setSelectedIds([result.groupId]);
    }
  };
  const chooseUngroup = () => {
    if (selectedLayer?.type === 'group') {
      const result = ungroupLayer(currentRef.current, selectedLayer.id);
      commit(result.scene);
      setSelectedIds(result.selectedIds);
    }
  };
  const filteredAssets = allAssets.filter(
    (asset) =>
      (asset.kind === 'image' || asset.kind === 'video') &&
      asset.name.toLowerCase().includes(assetQuery.toLowerCase()),
  );

  return (
    <div
      className="ce-editor"
      ref={rootRef}
      tabIndex={-1}
      data-mobile-panel={mobilePanel}
      aria-label={t('作品画布编辑器')}
    >
      <div className="ce-toolbar" role="toolbar" aria-label={t('画布工具')}>
        <div className="ce-toolbar-group">
          <button
            type="button"
            className={!panMode ? 'is-active' : ''}
            onClick={() => setPanMode(false)}
            title={t('选择图层')}
            aria-label={t('选择图层')}
            aria-pressed={!panMode}
          >
            <MousePointer2 size={17} />
          </button>
          <button
            type="button"
            className={panMode ? 'is-active' : ''}
            onClick={() => setPanMode(true)}
            title={t('平移画布')}
            aria-label={t('平移画布')}
            aria-pressed={panMode}
          >
            <Hand size={17} />
          </button>
        </div>
        {!readOnly && (
          <>
            <span className="ce-toolbar-divider" />
            <div className="ce-toolbar-group">
              <button
                type="button"
                onClick={() =>
                  addLayer({
                    ...layerBase(t('文字'), 440, 80),
                    type: 'text',
                    text: t('写下你的好想法'),
                    fontFamily: 'sans-serif',
                    fontSize: 48,
                    fontWeight: 'bold',
                    fontStyle: 'normal',
                    fill: '#182126',
                    textAlign: 'left',
                    lineHeight: 1.3,
                    underline: false,
                  })
                }
              >
                <Type size={17} />
                <span>{t('文字')}</span>
              </button>
              <button type="button" onClick={() => setDialog('assets')}>
                <ImagePlus size={17} />
                <span>{t('素材')}</span>
              </button>
              <button
                type="button"
                onClick={() =>
                  addLayer({
                    ...layerBase(t('矩形')),
                    type: 'shape',
                    shape: 'rect',
                    fill: '#DDF3AD',
                    stroke: '#426856',
                    strokeWidth: 0,
                    cornerRadius: 16,
                  })
                }
                title={t('添加矩形')}
                aria-label={t('添加矩形')}
              >
                <Square size={17} />
              </button>
              <button
                type="button"
                onClick={() =>
                  addLayer({
                    ...layerBase(t('椭圆'), 180, 180),
                    type: 'shape',
                    shape: 'ellipse',
                    fill: '#EAF1EC',
                    stroke: '#426856',
                    strokeWidth: 0,
                    cornerRadius: 0,
                  })
                }
                title={t('添加椭圆')}
                aria-label={t('添加椭圆')}
              >
                <Circle size={17} />
              </button>
            </div>
            <span className="ce-toolbar-divider" />
            <div className="ce-toolbar-group">
              <button
                type="button"
                disabled={!history.current.past.length}
                onClick={undo}
                title={t('撤销 · ⌘Z')}
                aria-label={t('撤销编辑')}
              >
                <Undo2 size={17} />
              </button>
              <button
                type="button"
                disabled={!history.current.future.length}
                onClick={redo}
                title={t('重做 · ⌘⇧Z')}
                aria-label={t('重做')}
              >
                <Redo2 size={17} />
              </button>
              <button
                type="button"
                disabled={!canGroup}
                onClick={chooseGroup}
                title={t('将选中图层分组')}
                aria-label={t('将选中图层分组')}
              >
                <Group size={17} />
              </button>
              <button
                type="button"
                disabled={selectedLayer?.type !== 'group' || selectedLayer.locked}
                onClick={chooseUngroup}
                title={t('取消分组')}
                aria-label={t('取消分组')}
              >
                <Ungroup size={17} />
              </button>
            </div>
          </>
        )}
        <div className="ce-toolbar-end">
          <span className="ce-dimensions">
            {Math.round(current.canvas.width)} × {Math.round(current.canvas.height)}
          </span>
          {allowOriginalDownload && (
            <button
              type="button"
              className="ce-export-button"
              onClick={() => {
                setNotice('');
                setDialog('export');
              }}
            >
              <Download size={16} />
              <span>{t('导出')}</span>
            </button>
          )}
        </div>
      </div>
      <div
        className="ce-mobile-tabs"
        role="tablist"
        aria-label={t('编辑面板')}
        onKeyDown={(event) => {
          const panels = ['canvas', 'layers', 'properties'] as const;
          const index = panels.indexOf(mobilePanel);
          const rtl = document.documentElement.dir === 'rtl';
          let next = index;
          if (event.key === 'ArrowRight') next = (index + (rtl ? 2 : 1)) % 3;
          else if (event.key === 'ArrowLeft') next = (index + (rtl ? 1 : 2)) % 3;
          else if (event.key === 'Home') next = 0;
          else if (event.key === 'End') next = 2;
          else return;
          event.preventDefault();
          const selected = panels[next];
          if (!selected) return;
          setMobilePanel(selected);
          if (selected !== 'canvas') setPanel(selected);
          event.currentTarget.querySelectorAll('button')[next]?.focus();
        }}
      >
        <button
          type="button"
          role="tab"
          id={`${editorId}-canvas-tab`}
          aria-controls={`${editorId}-canvas`}
          tabIndex={mobilePanel === 'canvas' ? 0 : -1}
          aria-selected={mobilePanel === 'canvas'}
          onClick={() => setMobilePanel('canvas')}
        >
          <Square size={15} />
          {t('画布')}
        </button>
        <button
          type="button"
          role="tab"
          id={`${editorId}-layers-tab`}
          aria-controls={`${editorId}-side`}
          tabIndex={mobilePanel === 'layers' ? 0 : -1}
          aria-selected={mobilePanel === 'layers'}
          onClick={() => {
            setPanel('layers');
            setMobilePanel('layers');
          }}
        >
          <Layers size={15} />
          {t('图层')}
        </button>
        <button
          type="button"
          role="tab"
          id={`${editorId}-properties-tab`}
          aria-controls={`${editorId}-side`}
          tabIndex={mobilePanel === 'properties' ? 0 : -1}
          aria-selected={mobilePanel === 'properties'}
          onClick={() => {
            setPanel('properties');
            setMobilePanel('properties');
          }}
        >
          <SlidersHorizontal size={15} />
          {t('属性')}
        </button>
      </div>
      {notice && (
        <div className="ce-notice" role="status">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label={t('关闭提示')}>
            <X size={15} />
          </button>
        </div>
      )}
      {mediaWarnings.length > 0 && (
        <div className="ce-warning" role="alert">
          {mediaWarnings.length}
          {t('个素材无法读取。红色虚线为缺失位置；导出前请恢复素材。')}
          {mediaWarnings[0]}
        </div>
      )}
      <div className="ce-body">
        <div className="ce-canvas-area" id={`${editorId}-canvas`}>
          <div
            className="ce-canvas-host"
            ref={hostRef}
            onPointerDown={() => rootRef.current?.focus({ preventScroll: true })}
          >
            <canvas
              ref={elementRef}
              aria-label={t('作品画布，编辑操作也可通过图层与属性面板完成')}
            />
          </div>
          {loading && (
            <div className="ce-loading" role="status">
              <LoaderCircle size={15} className="ce-spin" />
              {t('正在读取素材')}
            </div>
          )}
          {current.layers.length === 0 && !loading && (
            <div className="ce-empty-canvas">
              <div className="ce-empty-icon">
                <ImagePlus size={24} />
              </div>
              <strong>{t('好作品，从这里开始')}</strong>
              <span>
                {readOnly ? t('此画布尚未添加内容') : t('添加素材、文字，或把生成结果放进画布')}
              </span>
              {!readOnly && (
                <button type="button" onClick={() => setDialog('assets')}>
                  {t('添加第一张图片')}
                  <Plus size={14} />
                </button>
              )}
            </div>
          )}
          <div className="ce-zoom-controls">
            <button type="button" onClick={() => changeZoom(1 / 1.25)} aria-label={t('缩小画布')}>
              <Minus size={15} />
            </button>
            <span aria-live="off">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={() => changeZoom(1.25)} aria-label={t('放大画布')}>
              <Plus size={15} />
            </button>
            <span className="ce-toolbar-divider" />
            <button type="button" onClick={fit} aria-label={t('适应窗口')} title={t('适应窗口')}>
              <Expand size={15} />
            </button>
          </div>
        </div>
        <aside className="ce-sidebar" id={`${editorId}-side`}>
          <div className="ce-panel-tabs">
            <button
              type="button"
              className={panel === 'layers' ? 'is-active' : ''}
              onClick={() => setPanel('layers')}
            >
              {t('图层')}
            </button>
            <button
              type="button"
              className={panel === 'properties' ? 'is-active' : ''}
              onClick={() => setPanel('properties')}
            >
              {t('属性')}
            </button>
          </div>
          {panel === 'layers' ? (
            <LayerPanel
              layers={current.layers}
              selectedIds={selectedIds}
              readOnly={readOnly}
              onSelect={selectLayer}
              onPatch={patchLayer}
              onMove={(id, delta) => commit(reorderLayer(currentRef.current, id, delta))}
              onDuplicate={(id) => duplicateLayers([id])}
              onDelete={(id) => removeLayers([id])}
            />
          ) : (
            <PropertiesPanel
              scene={current}
              layer={selectedLayer}
              assets={allAssets}
              readOnly={readOnly}
              allowOriginalDownload={allowOriginalDownload}
              onPatch={patchLayer}
              onCanvas={(patch) =>
                commit({
                  ...currentRef.current,
                  canvas: { ...currentRef.current.canvas, ...patch },
                })
              }
              onAlign={(alignment) =>
                commit(alignLayers(currentRef.current, selectedRef.current, alignment))
              }
            />
          )}
        </aside>
      </div>
      <input
        type="file"
        ref={fileRef}
        accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm"
        hidden
        onChange={(event) => {
          void upload(event.target.files?.[0]);
        }}
      />
      <Dialog.Root
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open && !exporting && !uploading) setDialog(null);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="ce-dialog-overlay" />
          <Dialog.Content className="ce-dialog" aria-describedby={`${editorId}-description`}>
            <div className="ce-dialog-header">
              <Dialog.Title>
                {dialog === 'assets' ? t('把灵感放进画布') : t('导出作品')}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button type="button" aria-label={t('关闭窗口')} disabled={exporting || uploading}>
                  <X size={19} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description id={`${editorId}-description`} className="ce-dialog-description">
              {dialog === 'assets'
                ? t('选择已有素材，或上传新的图片与视频。')
                : t('导出画布中的可见内容。视频图层会导出为静态图片。')}
            </Dialog.Description>
            {notice && (
              <div className="ce-warning" role="alert">
                {notice}
              </div>
            )}
            {dialog === 'assets' ? (
              <>
                <div className="ce-asset-actions">
                  <input
                    type="search"
                    aria-label={t('搜索画布素材')}
                    placeholder={t('搜索素材名称')}
                    value={assetQuery}
                    onChange={(event) => setAssetQuery(event.target.value)}
                  />
                  {onUpload && (
                    <button
                      type="button"
                      className="ce-primary-button"
                      disabled={uploading || readOnly}
                      onClick={() => fileRef.current?.click()}
                    >
                      {uploading ? (
                        <LoaderCircle size={16} className="ce-spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      {t('上传素材')}
                    </button>
                  )}
                </div>
                <div className="ce-asset-grid">
                  {filteredAssets.map((asset) => (
                    <button
                      type="button"
                      key={asset.id}
                      disabled={readOnly}
                      onClick={() => addAsset(asset)}
                      className="ce-asset-card"
                    >
                      {asset.thumbnailUrl || asset.previewUrl || asset.kind === 'image' ? (
                        <img
                          src={asset.thumbnailUrl ?? asset.previewUrl ?? asset.originalUrl}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <div className="ce-asset-placeholder">{t('视频')}</div>
                      )}
                      <span>{asset.name}</span>
                      <small>
                        {asset.kind === 'video' ? t('视频') : t('图片')}
                        {asset.width && asset.height ? ` · ${asset.width} × ${asset.height}` : ''}
                      </small>
                    </button>
                  ))}
                </div>
                {!filteredAssets.length && (
                  <div className="ce-panel-empty">
                    <ImagePlus size={28} />
                    <p>{assetQuery ? t('没有匹配的素材') : t('还没有可用的图片或视频')}</p>
                    <span>
                      {onUpload ? t('上传素材后即可开始排版') : t('请先到素材库上传作品')}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className="ce-panel-note" role="status">
                  {resolveExportPolicy && !exportPolicy
                    ? t('导出时将核对水印策略。')
                    : exportPolicy?.watermark
                      ? t('当前应用导出将添加工作空间水印。')
                      : exportPolicy?.reason === 'subscription-exempt'
                        ? t('当前有效订阅享有应用导出无水印权益。')
                        : t('当前应用导出不添加水印。')}{' '}
                  {t('导出时将重新核对策略；此规则不限制原素材下载，也不能防止客户端修改。')}
                </p>
                <label className="ce-field">
                  <span>{t('导出范围')}</span>
                  <select
                    value={exportScope}
                    disabled={exporting}
                    onChange={(event) => setExportScope(event.target.value as typeof exportScope)}
                  >
                    <option value="canvas">{t('整张画布')}</option>
                    <option value="selection" disabled={!selectedIds.length}>
                      {t('选中图层（裁切边界）')}
                    </option>
                    <option value="layers-zip" disabled={!selectedIds.length}>
                      {t('选中图层分别打包 ZIP')}
                    </option>
                    {exportBoards.length > 0 && (
                      <option value="boards-zip">{t('多画板打包 ZIP')}</option>
                    )}
                  </select>
                </label>
                <div className="ce-export-preview">
                  <Square size={24} />
                  <div>
                    <strong>
                      {exportScope === 'canvas'
                        ? `${Math.round(current.canvas.width * exportScale)} × ${Math.round(current.canvas.height * exportScale)} px`
                        : t('按各选区或画板的实际像素导出')}
                    </strong>
                    <span>
                      {current.layers.filter((layer) => layer.visible).length}
                      {t('个可见图层 ·')}{' '}
                      {exportFormat === 'png' ? t('PNG 无损图片') : t('JPG 图片')}
                    </span>
                  </div>
                </div>
                <div className="ce-field-grid">
                  <label className="ce-field">
                    <span>{t('格式')}</span>
                    <select
                      value={exportFormat}
                      disabled={exporting}
                      onChange={(event) => setExportFormat(event.target.value as 'png' | 'jpeg')}
                    >
                      <option value="png">PNG</option>
                      <option value="jpeg">JPG</option>
                    </select>
                  </label>
                  <label className="ce-field">
                    <span>{t('导出倍率')}</span>
                    <select
                      value={exportScale}
                      disabled={exporting}
                      onChange={(event) => setExportScale(Number(event.target.value))}
                    >
                      <option value={1}>{t('1× 原始尺寸')}</option>
                      <option value={2}>{t('2× 双倍尺寸')}</option>
                      <option value={3}>{t('3× 三倍尺寸')}</option>
                    </select>
                  </label>
                </div>
                <label className="ce-check">
                  <input
                    type="checkbox"
                    checked={exportTransparent && exportFormat === 'png'}
                    disabled={exporting || exportFormat !== 'png'}
                    onChange={(event) => setExportTransparent(event.target.checked)}
                  />
                  {t('透明背景（PNG）')}
                </label>
                <label className="ce-check">
                  <input
                    type="checkbox"
                    checked={includeProvenance}
                    disabled={exporting}
                    onChange={(event) => setIncludeProvenance(event.target.checked)}
                  />
                  {t('包含 AI 来源记录与可用参数（ZIP）')}
                </label>
                <p className="ce-panel-note">
                  {t('来源信息写入 manifest.json，仅包含已有记录；不向图片伪造嵌入式 AI 元信息。')}
                </p>
                <p className="ce-panel-note">
                  {t('原始素材以完整分辨率参与绘制。导出使用同一画布渲染器，最高6400万像素。')}
                </p>
                <button
                  type="button"
                  className="ce-primary-button ce-export-submit"
                  disabled={
                    exporting ||
                    !allowOriginalDownload ||
                    (exportScope === 'canvas' &&
                      current.canvas.width * current.canvas.height * exportScale ** 2 > 67108864)
                  }
                  onClick={() => {
                    void runExport();
                  }}
                >
                  {exporting ? (
                    <LoaderCircle className="ce-spin" size={17} />
                  ) : (
                    <Download size={17} />
                  )}
                  {exporting ? t('正在生成图片…') : t('生成并下载')}
                </button>
                {exportScope === 'canvas' &&
                  current.canvas.width * current.canvas.height * exportScale ** 2 > 67108864 && (
                    <p className="ce-warning">{t('当前倍率超过导出上限，请降低倍率。')}</p>
                  )}
              </>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

export default CanvasEditor;
