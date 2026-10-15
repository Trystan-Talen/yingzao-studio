import { z } from 'zod';
import * as c from '../../contracts/core';
import { EntitlementsSchema } from '../../contracts/entitlements';
const data = (schema: z.ZodType) => z.object({ data: schema });
const page = (schema: z.ZodType) =>
  data(
    z.object({
      items: z.array(schema),
      total: z.number().int(),
      page: z.number().int(),
      pageSize: z.number().int(),
    }),
  );
const bodySchemas: Record<string, z.ZodType> = {
  'POST /auth/register': c.RegisterInputSchema,
  'POST /auth/login': c.LoginInputSchema,
  'PATCH /auth/me': c.UpdateMeInputSchema,
  'POST /workspaces': c.WorkspaceInputSchema,
  'PATCH /workspaces/:id': c.WorkspacePatchSchema,
  'POST /workspaces/:id/leave': c.ConfirmInputSchema,
  'POST /workspaces/:id/archive': c.ConfirmInputSchema,
  'POST /workspaces/:id/transfer': c.TransferWorkspaceInputSchema,
  'POST /projects': c.CreateProjectInputSchema,
  'PATCH /projects/:id': c.ProjectPatchSchema,
  'PUT /projects/:id/favorite': c.FavoriteInputSchema,
  'PATCH /documents/:id': c.UpdateDocumentInputSchema,
  'POST /documents/:id/restore': c.RestoreDocumentInputSchema,
  'PATCH /assets/:id': c.AssetPatchSchema,
  'PUT /assets/:id/favorite': c.FavoriteInputSchema,
  'POST /collections': c.WorkspaceInputSchema,
  'PATCH /collections/:id': c.WorkspaceInputSchema,
  'PUT /collections/:id/assets': c.SetCollectionAssetsInputSchema,
  'POST /brands': c.BrandInputSchema,
  'PATCH /brands/:id': c.BrandPatchSchema,
  'POST /characters': c.CharacterInputSchema,
  'PATCH /characters/:id': c.CharacterPatchSchema,
  'POST /characters/:id/authorization': c.CharacterAuthorizationInputSchema,
  'DELETE /characters/:id/authorization': c.ReasonInputSchema,
  'POST /characters/:id/verification/start': z.object({}).strict(),
  'POST /characters/:id/verification/:sessionId/poll': z.object({}).strict(),
  'POST /invoices/:id/withdraw': c.InvoiceWithdrawInputSchema,
  'PATCH /members/:id': c.MemberPatchSchema,
  'POST /members/import': c.MemberImportInputSchema,
  'POST /invitations': c.InvitationInputSchema,
  'POST /invitations/accept': c.AcceptInvitationInputSchema,
  'POST /api-keys': c.ApiKeyInputSchema,
  'POST /orders': c.CreateOrderInputSchema,
  'POST /invoice-titles': c.InvoiceTitleInputSchema,
  'PATCH /invoice-titles/:id': c.InvoiceTitleInputSchema,
  'POST /invoices': c.CreateInvoiceInputSchema,
  'POST /support/tickets': c.TicketInputSchema,
  'POST /support/tickets/:id/replies': c.TicketReplyInputSchema,
  'POST /shares': c.ShareInputSchema,
  'POST /public/shares/read': c.ReadShareInputSchema,
  'POST /public/shares/asset': c.ShareMediaInputSchema,
};
const entitySchemas: Record<string, z.ZodType> = {
  projects: c.ProjectSchema,
  assets: c.AssetSchema,
  brands: c.BrandSchema,
  characters: c.CharacterSchema,
  documents: c.DocumentSchema,
};
export function coreRouteSchema(method: string, url: string) {
  const body = bodySchemas[`${method} ${url}`],
    parts = url.split('/').filter(Boolean),
    resource = parts[0] ?? 'core',
    entity = entitySchemas[resource];
  const schema: {
    tags: string[];
    summary: string;
    body?: z.ZodType;
    params?: z.ZodType;
    response?: Record<number, z.ZodType>;
  } = { tags: [resource], summary: `${method} ${url}` };
  if (body) schema.body = body;
  const pathParams: Record<string, z.ZodType> = {};
  for (const part of parts)
    if (part.startsWith(':'))
      pathParams[part.slice(1)] =
        part === ':revision' ? z.string().regex(/^[1-9][0-9]*$/) : c.IdSchema;
  if (Object.keys(pathParams).length) schema.params = z.object(pathParams);
  if (entity) {
    if (method === 'GET' && parts.length === 1) schema.response = { 200: page(entity) };
    else if (
      (method === 'GET' && parts.length === 2) ||
      method === 'PATCH' ||
      (method === 'POST' && (parts.length === 1 || parts[2] === 'restore'))
    )
      schema.response = { [method === 'POST' && parts.length === 1 ? 201 : 200]: data(entity) };
  }
  if (url === '/characters/:id/authorization')
    schema.response = { 200: data(c.CharacterAuthorizationSchema) };
  if (url === '/entitlements') schema.response = { 200: data(EntitlementsSchema) };
  if (method === 'GET' && url === '/projects/:id/shares')
    schema.response = { 200: page(c.ShareSchema) };
  if (method === 'POST' && url === '/shares') schema.response = { 201: data(c.CreatedShareSchema) };
  if (method === 'POST' && url === '/public/shares/read')
    schema.response = { 200: data(c.PublicShareSchema) };
  if (url === '/projects/:id/document') schema.response = { 200: data(c.DocumentSchema) };
  if (url === '/assets/:id/text') schema.response = { 200: data(c.AssetTextSchema) };
  if (url === '/documents/:id/versions') schema.response = { 200: page(c.DocumentVersionSchema) };
  if (url === '/documents/:id/versions/:revision')
    schema.response = {
      200: data(
        z.object({ version: c.DocumentVersionSchema, scene: c.DocumentSchema.shape.scene }),
      ),
    };
  return schema;
}
