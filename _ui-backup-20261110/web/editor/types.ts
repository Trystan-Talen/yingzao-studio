import type { ExportPolicy } from '../../contracts/export-policy';
import type { SceneDocumentV1 } from '../../contracts/scene.js';

/** Structurally compatible with AssetDto, without coupling the editor to HTTP. */
export interface EditorAsset {
  id: string;
  name: string;
  kind: 'image' | 'video' | 'audio' | 'document';
  originalUrl: string;
  previewUrl?: string | null;
  thumbnailUrl?: string | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  sourceJobId?: string | null;
  originalAvailable?: boolean;
  playable?: boolean;
}

export interface ExportMetadata {
  documentId?: string;
  revision?: number;
  sourceJobs?: Array<{ id: string; operation: string; providerId: string; parameters: unknown }>;
}
export interface ExportBoard {
  id: string;
  name: string;
  scene: SceneDocumentV1;
  metadata?: ExportMetadata;
  layerIds?: string[];
}
export interface CanvasEditorProps {
  scene: SceneDocumentV1;
  onChange: (scene: SceneDocumentV1) => void;
  assets: EditorAsset[];
  onUpload?: (file: File) => Promise<EditorAsset>;
  readOnly?: boolean;
  allowOriginalDownload?: boolean;
  exportPolicy?: ExportPolicy;
  resolveExportPolicy?: () => Promise<ExportPolicy>;
  exportMetadata?: ExportMetadata;
  exportBoards?: ExportBoard[];
}
