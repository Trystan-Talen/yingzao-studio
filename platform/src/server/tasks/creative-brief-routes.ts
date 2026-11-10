import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Actor, Permission } from '../../contracts/core';
import type { TaskServices } from './service';
import { createCreativeBriefServices, creativePrepareSchema } from './creative-briefs';

export function registerCreativeBriefRoutes(
  app: FastifyInstance,
  tasks: TaskServices,
  access: (
    req: FastifyRequest,
    permission?: Permission,
    scope?: string,
  ) => Promise<{ actor: Actor; wid: string }>,
) {
  const briefs = createCreativeBriefServices(tasks);
  app.post(
    '/api/v1/creative-briefs/prepare',
    {
      schema: { body: creativePrepareSchema },
      config: { rateLimit: { max: 8, timeWindow: '1 minute' } },
    },
    async (req) => {
      const { actor, wid } = await access(req, 'write', 'jobs:write');
      return { data: await briefs.prepare(actor, wid, req.body) };
    },
  );
  app.get(
    '/api/v1/creative-briefs/:id',
    { schema: { params: z.object({ id: z.string().uuid() }) } },
    async (req, reply) => {
      const { actor, wid } = await access(req, 'read', 'jobs:read');
      reply.header('Cache-Control', 'private, no-store');
      return { data: briefs.get(actor, wid, (req.params as { id: string }).id) };
    },
  );
}
