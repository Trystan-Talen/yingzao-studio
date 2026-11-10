import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Permission } from '../../contracts/core';
import { detailPageBriefSchema, detailPageConfirmationSchema } from '../../contracts/detail-page';
import type { TaskServices } from './service';
import { createDetailPageServices } from './detail-pages';

export function registerDetailPageRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
  access: (
    req: FastifyRequest,
    permission?: Permission,
    scope?: string,
  ) => Promise<{ actor: Actor; wid: string }>,
) {
  const details = createDetailPageServices(tasks);
  app.post(
    '/api/v1/detail-pages/plan-quote',
    { schema: { body: detailPageBriefSchema } },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'jobs:write');
      return { data: details.planQuote(actor, wid, req.body) };
    },
  );
  app.post(
    '/api/v1/detail-pages/quote',
    { schema: { body: detailPageConfirmationSchema } },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'jobs:write');
      return { data: details.quote(actor, wid, req.body) };
    },
  );
  app.get(
    '/api/v1/detail-pages/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req) => {
      const { actor, wid } = await access(req, 'read', 'jobs:read');
      const { id } = req.params as { id: string };
      return { data: details.get(actor, wid, id) };
    },
  );
}
