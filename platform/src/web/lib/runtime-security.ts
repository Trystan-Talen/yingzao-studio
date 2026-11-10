import { z } from 'zod';

// Run before shared contracts are initialized: the object-schema constructor
// otherwise probes dynamic execution, which violates the production script policy.
// This entry is browser-only; server validation keeps its existing configuration.
z.config({ jitless: true });
