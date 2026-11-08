import { fieldBlocks, type Block, type WorkData } from './schema';

export const fieldTitles: Record<(typeof fieldBlocks)[number], string> = {
  my_contribution: '自分が担当したこと',
  team_result: 'チームで作ったもの',
  ingenuity: '工夫したこと',
  outcome: '結果と学んだこと',
  next_interest: '次にしてみたいこと',
};

/** The order a work had before blocks existed: images first, then each written section. */
export function defaultLayout(data: Pick<WorkData, 'asset_ids'>): Block[] {
  return [
    ...(data.asset_ids.length
      ? [
          {
            id: 'images-1',
            type: 'images' as const,
            asset_ids: data.asset_ids,
            columns: 1 as const,
            size: 'large' as const,
          },
        ]
      : []),
    ...fieldBlocks.map((field) => ({ id: `field-${field}`, type: 'field' as const, field })),
  ];
}

/** Stored layout, with images that are no longer attached removed. */
export function layoutOf(data: Pick<WorkData, 'asset_ids' | 'layout'>): Block[] {
  if (!data.layout?.length) return defaultLayout(data);
  const attached = new Set(data.asset_ids);
  return data.layout.map((block) =>
    block.type === 'images'
      ? { ...block, asset_ids: block.asset_ids.filter((id) => attached.has(id)) }
      : block,
  );
}

/** Every image placed in a block must also be listed on the work. */
export function withLayout(data: WorkData, layout: Block[]): WorkData {
  const placed = layout.flatMap((b) => (b.type === 'images' ? b.asset_ids : []));
  return { ...data, layout, asset_ids: [...new Set([...placed, ...data.asset_ids])].slice(0, 12) };
}
