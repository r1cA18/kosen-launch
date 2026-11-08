import { mkdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

export const tailwindArgs = [
  process.execPath,
  '--bun',
  'node_modules/@tailwindcss/cli/dist/index.mjs',
  '-i',
  'src/styles/app.css',
  '-o',
  'public/style.css',
];

export async function buildAssets() {
  await mkdir('public/fonts', { recursive: true });
  const fonts = [
    {
      directory: 'node_modules/@fontsource-variable/inter',
      styles: ['wght.css'],
      license: 'inter',
    },
    {
      directory: 'node_modules/@fontsource/zen-kaku-gothic-new',
      styles: ['400.css', '500.css', '700.css'],
      license: 'zen-kaku-gothic-new',
    },
  ];
  const styles: string[] = [];
  for (const font of fonts) {
    for (const name of font.styles) {
      const css = (await Bun.file(join(font.directory, name)).text()).replace(
        /,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g,
        '',
      );
      for (const match of css.matchAll(/url\(\.\/files\/([-a-z0-9]+\.woff2)\)/g)) {
        await copyFile(join(font.directory, 'files', match[1]), join('public/fonts', match[1]));
      }
      styles.push(css.replaceAll('./files/', '/fonts/'));
    }
    await copyFile(join(font.directory, 'LICENSE'), `public/fonts/LICENSE-${font.license}.txt`);
  }
  await Bun.write('public/fonts.css', styles.join('\n'));
  const css = Bun.spawn([...tailwindArgs, '--minify'], { stdout: 'inherit', stderr: 'inherit' });
  if ((await css.exited) !== 0) throw new Error('CSSのビルドに失敗しました。');
}

if (import.meta.main) await buildAssets();
