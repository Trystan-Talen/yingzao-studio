import type { FastifyRequest } from 'fastify';
import type { Actor, Permission } from '../../contracts/core';
import type { DatabaseContext } from '../db/connection';
import { CoreContext, type CoreConfig, type CoreHooks } from './shared';
import { AuthService } from './auth';
import { AssetService } from './assets';
import { DocumentService, ProjectService } from './projects';
import { ReferenceService } from './references';
import { TeamService } from './team';
import { BusinessService } from './business';
import { MemberImportService } from './member-import';
import { ShareService } from './shares';
import { IdentityService } from './identity';
import { ReferralService } from './referrals';
import { EntitlementService } from './entitlements';
export type { CoreConfig, CoreHooks } from './shared';
export type { IngestAssetInput, PreparedAsset, PreparedVariant } from './storage';
export type { JobAssetContext } from './assets';
export type { DocumentDto, SaveDocumentInput } from './projects';
export function createCoreServices(db: DatabaseContext, config: CoreConfig, hooks: CoreHooks = {}) {
  const context = new CoreContext(db, config, hooks),
    auth = new AuthService(context),
    assets = new AssetService(context),
    documents = new DocumentService(context),
    projects = new ProjectService(context, documents),
    references = new ReferenceService(context),
    team = new TeamService(context, auth),
    business = new BusinessService(context),
    memberImport = new MemberImportService(context, team),
    shares = new ShareService(context, documents, assets);
  return {
    context,
    auth,
    entitlements: new EntitlementService(context),
    identity: new IdentityService(context),
    referrals: new ReferralService(context),
    assets,
    documents,
    projects,
    references,
    brands: { get: references.getBrand.bind(references), list: references.brands.bind(references) },
    team,
    business,
    shares,
    memberImport,
    authenticate: (request: FastifyRequest) => auth.authenticate(request),
    requireAccess: (actor: Actor, wid: string, permission: Permission) =>
      context.requireAccess(actor, wid, permission),
    requireScope: (actor: Actor, scope: string) => context.requireScope(actor, scope),
  };
}
export type CoreServices = ReturnType<typeof createCoreServices>;
export { registerCoreRoutes } from './routes';
