import { buildAssets } from './assets';

await buildAssets();
const result = await Bun.build({
  entrypoints: ['src/server.ts', 'src/mcp.ts'],
  outdir: 'dist',
  target: 'bun',
  sourcemap: 'external',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log('Built server and MCP. Run from the project root with public/ and skills/.');
export {};
