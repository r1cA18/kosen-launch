import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { join } from 'node:path';
import { createMcpServer, fetchApi, loadSkillCatalog } from './mcp-tools';

const base = new URL(process.env.KOSEN_LAUNCH_URL ?? 'http://127.0.0.1:4177');
const token = process.env.KOSEN_LAUNCH_TOKEN;
if (!token) throw new Error('KOSEN_LAUNCH_TOKENを設定してください。');
if (
  base.username ||
  base.password ||
  (base.protocol !== 'https:' &&
    !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))
) {
  throw new Error('接続先はHTTPSまたはローカルのHTTPを指定してください。');
}
const api = fetchApi(fetch, base.origin, token);
const skill = Bun.file(join(import.meta.dir, '../skills/kosen-portfolio/SKILL.md'));
const skills = skill
  .exists()
  .then((found) => (found ? skill.text() : undefined))
  .then(loadSkillCatalog);
serveStdio(() => createMcpServer(api, { localFiles: true, skills }));
