// React-free entry to Meniscus 0.6.0 (MIT). The published `meniscus/webgl` entry also
// exports React components, so the renderer and color parser are loaded from the
// distribution modules that contain them. The version is pinned in package.json.
import type * as Webgl from 'meniscus/webgl';
// @ts-expect-error distribution module without its own declaration file
import * as renderer from '../../node_modules/meniscus/dist/chunk-I2AWCO4T.js';
// @ts-expect-error distribution module without its own declaration file
import * as color from '../../node_modules/meniscus/dist/chunk-HKX4HYSE.js';

export const GlassRenderer = renderer.GlassRenderer as typeof Webgl.GlassRenderer;
export type GlassRenderer = Webgl.GlassRenderer;
export const MAX_PANES = renderer.MAX_PANES as typeof Webgl.MAX_PANES;
export const parseColor = color.parseColor as typeof Webgl.parseColor;
export { resolveGlass } from 'meniscus/core';
