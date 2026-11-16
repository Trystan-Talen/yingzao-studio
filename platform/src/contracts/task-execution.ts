export interface ExecutionResource {
  id: string;
  name: string;
  kind?: string;
  baseUrl?: string;
  model?: string;
  protocol?: string;
}
export interface ExecutionAttemptEvent {
  attemptId?: string;
  stage?: string;
  action: 'submit' | 'poll' | 'cancel';
  status: 'started' | 'succeeded' | 'submitted' | 'running' | 'rejected' | 'uncertain' | 'failed';
  resource?: ExecutionResource;
  httpStatus?: number;
  errorCode?: string;
  message?: string;
  requestId?: string;
  remoteId?: string;
  metadata?: unknown;
  durationMs?: number;
}
export interface TaskExecutionLogDto extends ExecutionAttemptEvent {
  id: number;
  itemId: string | null;
  briefId: string | null;
  origin: 'planning' | 'execution';
  providerId: string;
  createdAt: string;
}
export interface TaskExecutionLogsDto {
  jobId: string;
  providerId: string;
  status: string;
  stage: string;
  diagnosis: string;
  waitingForReconciliation: number;
  items: {
    id: string;
    index: number;
    status: string;
    phase: string;
    attempts: number;
    recoveryFailures: number;
    remoteId: string | null;
    errorMessage: string | null;
    nextAttemptAt: string;
    leaseUntil: string | null;
    leaseActive: boolean;
    upstreamMetadata: unknown;
  }[];
  lifecycle: { id: number; type: string; createdAt: string; details: unknown }[];
  logs: TaskExecutionLogDto[];
  total: number;
  page: number;
  pageSize: number;
  generatedAt: string;
}
