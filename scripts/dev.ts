import { buildAssets, tailwindArgs } from './assets';

await buildAssets();
const processes = [
  Bun.spawn([...tailwindArgs, '--watch=always'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn([process.execPath, '--watch', 'src/server.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
  }),
];
const stop = () => {
  for (const child of processes) child.kill();
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, stop);
const code = await Promise.race(processes.map((child) => child.exited));
stop();
await Promise.all(processes.map((child) => child.exited));
process.exit(code);
