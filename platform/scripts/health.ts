import { loadConfig } from '../src/server/config';
const c = loadConfig();
const response = await fetch(`http://${c.host}:${c.port}/api/v1/health`);
if (!response.ok) throw new Error(`HTTP ${response.status}`);
console.info(await response.text());
