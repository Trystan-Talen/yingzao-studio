import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Permission } from '../../contracts/core';
import { backgroundRefinePrepareSchema } from '../../contracts/background-review';
import type { TaskServices } from './service';
import { createBackgroundReviewServices } from './background-review';

export function registerBackgroundReviewRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
  access: (
    req: FastifyRequest,
    permission?: Permission,
    scope?: string,
  ) => Promise<{ actor: Actor; wid: string }>,
) {
  const service = createBackgroundReviewServices(tasks);
  const params = z.object({ jobId: z.string().uuid(), itemId: z.string().uuid() });
  const base = '/api/v1/jobs/:jobId/items/:itemId/background-review';
  app.get(base, { schema: { params } }, async (req, reply) => {
    const { actor, wid } = await access(req, 'read', 'jobs:read');
    const ids = params.parse(req.params);
    reply.header('Cache-Control', 'private, no-store');
    return { data: service.get(actor, wid, ids.jobId, ids.itemId) };
  });
  app.post(
    `${base}/prepare`,
    { schema: { params, body: backgroundRefinePrepareSchema } },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'jobs:write');
      const ids = params.parse(req.params);
      return { data: await service.prepare(actor, wid, ids.jobId, ids.itemId, req.body) };
    },
  );
}
