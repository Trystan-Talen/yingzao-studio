import * as inputs from '../../contracts/core';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { z } from 'zod';
import type { Actor } from '../../contracts/core';
import { AppError } from '../errors';
import { CoreContext, str } from './shared';
import { TeamService } from './team';
const rowSchema = inputs.MemberImportRowSchema;
export type MemberImportRow = z.infer<typeof rowSchema>;
export interface ImportPreviewRow {
  row: number;
  values: Record<string, unknown>;
  valid: boolean;
  errors: string[];
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!cell || quoted) quoted = !quoted;
      else throw new AppError(400, 'INVALID_CSV', 'CSV引号不合法');
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(cell);
      cell = '';
      if (ch !== ',') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        if (row.some((c) => c.trim())) rows.push(row);
        row = [];
      }
    } else cell += ch;
  }
  if (quoted) throw new AppError(400, 'INVALID_CSV', 'CSV引号未闭合');
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
export class MemberImportService {
  constructor(
    private c: CoreContext,
    private team: TeamService,
  ) {}
  async template(
    format: 'csv' | 'xlsx',
  ): Promise<{ buffer: Buffer; mimeType: string; name: string }> {
    const headers = ['email', 'role', 'nickname', 'creditLimit'];
    if (format === 'csv')
      return {
        buffer: Buffer.from('\uFEFF' + headers.join(',') + '\r\n'),
        mimeType: 'text/csv; charset=utf-8',
        name: 'members-template.csv',
      };
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Members');
    sheet.addRow(headers);
    sheet.columns.forEach((column) => {
      column.width = 25;
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: 'members-template.xlsx',
    };
  }
  async preview(
    actor: Actor,
    wid: string,
    buffer: Buffer,
    name: string,
  ): Promise<{ rows: ImportPreviewRow[]; validCount: number; invalidCount: number }> {
    this.c.requireAccess(actor, wid, 'manage');
    if (buffer.length > 2 * 1024 * 1024)
      throw new AppError(413, 'IMPORT_TOO_LARGE', '导入文件最大2MiB');
    let rows: unknown[][];
    if (name.toLowerCase().endsWith('.csv')) {
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        throw new AppError(400, 'INVALID_TEXT', 'CSV必须是UTF-8编码');
      }
      rows = parseCsv(text.replace(/^\uFEFF/, ''));
    } else if (name.toLowerCase().endsWith('.xlsx')) {
      const zip = await JSZip.loadAsync(buffer);
      if (Object.keys(zip.files).length > 1000)
        throw new AppError(413, 'IMPORT_TOO_LARGE', '表格结构过大');
      let total = 0;
      for (let offset = 0; offset + 46 <= buffer.length; offset++) {
        if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
        total += buffer.readUInt32LE(offset + 24);
        if (total > 20 * 1024 * 1024)
          throw new AppError(413, 'IMPORT_TOO_LARGE', '表格展开体积超过20MiB');
        offset +=
          45 +
          buffer.readUInt16LE(offset + 28) +
          buffer.readUInt16LE(offset + 30) +
          buffer.readUInt16LE(offset + 32);
      }
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      if (workbook.worksheets.length !== 1)
        throw new AppError(400, 'INVALID_WORKBOOK', '请使用仅一个工作表的模板');
      const sheet = workbook.worksheets[0]!;
      if (sheet.rowCount > 501) throw new AppError(413, 'IMPORT_TOO_MANY_ROWS', '最多导入500行');
      rows = [];
      sheet.eachRow({ includeEmpty: true }, (row) => {
        rows.push(
          [1, 2, 3, 4].map((index) => {
            const value = row.getCell(index).value;
            if (value === null) return '';
            if (typeof value === 'string' || typeof value === 'number') return value;
            return { invalidCell: '不支持公式、链接或复杂单元格' };
          }),
        );
      });
    } else throw new AppError(415, 'IMPORT_FORMAT', '请上传CSV或XLSX模板');
    if (rows.length > 501) throw new AppError(413, 'IMPORT_TOO_MANY_ROWS', '最多导入500行');
    const headers = rows.shift()?.map((v) => String(v).trim()) ?? [];
    if (headers.join(',') !== 'email,role,nickname,creditLimit')
      throw new AppError(400, 'INVALID_HEADERS', '表头必须为email,role,nickname,creditLimit');
    const seen = new Set<string>();
    const preview = rows
      .filter((row) => row.some((v) => v !== ''))
      .map((row, index) => {
        const values: Record<string, unknown> = {
          email: typeof row[0] === 'string' ? row[0].trim().toLowerCase() : row[0],
          role: row[1] || 'member',
          nickname: row[2] || '',
          creditLimit:
            row[3] === '' || row[3] === undefined
              ? null
              : typeof row[3] === 'object'
                ? row[3]
                : Number(row[3]),
        };
        const parsed = rowSchema.safeParse(values);
        const errors = parsed.success
          ? []
          : parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
        if (typeof values.email === 'string') {
          if (seen.has(values.email)) errors.push('文件内邮箱重复');
          seen.add(values.email);
        }
        return {
          row: index + 2,
          values: parsed.success ? parsed.data : values,
          valid: !errors.length,
          errors,
        };
      });
    return {
      rows: preview,
      validCount: preview.filter((r) => r.valid).length,
      invalidCount: preview.filter((r) => !r.valid).length,
    };
  }
  apply(actor: Actor, wid: string, raw: unknown) {
    this.c.requireAccess(actor, wid, 'manage');
    const { rows } = inputs.MemberImportInputSchema.parse(raw);
    const seen = new Set<string>();
    return {
      items: rows.map((row, index) => {
        const parsed = rowSchema.safeParse(row);
        if (!parsed.success)
          return {
            row: index + 1,
            status: 'failed',
            message: parsed.error.issues.map((i) => i.message).join('; '),
          };
        const input = parsed.data;
        input.email = input.email.toLowerCase();
        if (seen.has(input.email))
          return { row: index + 1, status: 'skipped', message: '重复邮箱' };
        seen.add(input.email);
        try {
          return this.c.transaction(() => {
            const member = this.c.get(
              'SELECT m.* FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? AND u.email=?',
              wid,
              input.email,
            );
            if (member) {
              this.team.updateMember(actor, wid, str(member, 'id'), {
                nickname: input.nickname,
                creditLimit: input.creditLimit,
              });
              return { row: index + 1, status: 'updated', email: input.email };
            }
            if (
              this.c.get(
                'SELECT id FROM invitations WHERE workspace_id=? AND email=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?',
                wid,
                input.email,
                new Date().toISOString(),
              )
            )
              return {
                row: index + 1,
                status: 'skipped',
                message: '已有有效邀请',
                email: input.email,
              };
            const invitation = this.team.invite(actor, wid, {
              email: input.email,
              role: input.role,
              creditLimit: input.creditLimit,
            });
            return { row: index + 1, status: 'invited', email: input.email, invitation };
          });
        } catch (error) {
          if (error instanceof AppError)
            return { row: index + 1, status: 'failed', message: error.message };
          throw error;
        }
      }),
    };
  }
  async export(actor: Actor, wid: string, format: 'csv' | 'xlsx') {
    this.c.requireAccess(actor, wid, 'manage');
    if (format === 'csv')
      return {
        buffer: Buffer.from(this.team.exportCsv(actor, wid)),
        mimeType: 'text/csv; charset=utf-8',
        name: 'members.csv',
      };
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Members');
    sheet.addRow(['email', 'displayName', 'role', 'nickname', 'creditLimit']);
    for (const row of this.c.all(
      'SELECT u.email,u.display_name,m.role,m.nickname,m.credit_limit FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,m.id',
      wid,
    ))
      sheet.addRow([row.email, row.display_name, row.role, row.nickname, row.credit_limit]);
    sheet.columns.forEach((col) => {
      col.width = 25;
    });
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      name: 'members.xlsx',
    };
  }
}
