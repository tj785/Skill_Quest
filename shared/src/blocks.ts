/**
 * Block catalog shared by server (validation, rewards) and client (rendering).
 * `tier` controls which question difficulty normally awards the block.
 * Natural blocks are generated terrain and are never handed out as rewards.
 */
export type Tier = 'natural' | 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface BlockDef {
  id: number;
  key: string;
  name: string;
  tier: Tier;
  /** Base color used for procedural textures and the minimap. */
  color: string;
  /** Optional different top / bottom colors (grass, logs). */
  top?: string;
  bottom?: string;
  /** Texture pattern drawn procedurally by the client. */
  pattern: 'noise' | 'bricks' | 'planks' | 'log' | 'glass' | 'leaves' | 'ore' | 'tiles' | 'crystal' | 'books' | 'column' | 'rainbow' | 'star';
  solid: boolean;
  transparent?: boolean;
  emissive?: boolean;
  /** Cannot be removed by anyone (world floor). */
  unbreakable?: boolean;
}

export const BLOCKS: BlockDef[] = [
  { id: 0, key: 'air', name: 'Air', tier: 'natural', color: '#000000', pattern: 'noise', solid: false, transparent: true },
  { id: 1, key: 'grass', name: 'Grass', tier: 'natural', color: '#6b8f3a', top: '#6fae3f', bottom: '#8a6440', pattern: 'noise', solid: true },
  { id: 2, key: 'dirt', name: 'Dirt', tier: 'common', color: '#8a6440', pattern: 'noise', solid: true },
  { id: 3, key: 'stone', name: 'Basic Stone', tier: 'common', color: '#8c8c8c', pattern: 'noise', solid: true },
  { id: 4, key: 'sand', name: 'Sand', tier: 'common', color: '#e2d39a', pattern: 'noise', solid: true },
  { id: 5, key: 'gravel', name: 'Gravel', tier: 'common', color: '#9a918a', pattern: 'ore', solid: true },
  { id: 6, key: 'log', name: 'Basic Wood', tier: 'common', color: '#7a5a34', top: '#b08a55', bottom: '#b08a55', pattern: 'log', solid: true },
  { id: 7, key: 'planks', name: 'Wood Planks', tier: 'common', color: '#b58b53', pattern: 'planks', solid: true },
  { id: 8, key: 'leaves', name: 'Leaves', tier: 'natural', color: '#3f8a34', pattern: 'leaves', solid: true },
  { id: 9, key: 'water', name: 'Water', tier: 'natural', color: '#3a7bd5', pattern: 'noise', solid: false, transparent: true },
  { id: 10, key: 'snow', name: 'Snow', tier: 'natural', color: '#f2f6fa', pattern: 'noise', solid: true },
  { id: 11, key: 'bricks', name: 'Bricks', tier: 'uncommon', color: '#a54a3a', pattern: 'bricks', solid: true },
  { id: 12, key: 'glass', name: 'Glass', tier: 'uncommon', color: '#cfe8f5', pattern: 'glass', solid: true, transparent: true },
  { id: 13, key: 'dark_planks', name: 'Fine Wood', tier: 'uncommon', color: '#5a3d24', pattern: 'planks', solid: true },
  { id: 14, key: 'stone_bricks', name: 'Stone Bricks', tier: 'uncommon', color: '#7d7f86', pattern: 'bricks', solid: true },
  { id: 15, key: 'red_block', name: 'Red Block', tier: 'uncommon', color: '#c8453c', pattern: 'tiles', solid: true },
  { id: 16, key: 'blue_block', name: 'Blue Block', tier: 'uncommon', color: '#3c6fc8', pattern: 'tiles', solid: true },
  { id: 17, key: 'yellow_block', name: 'Yellow Block', tier: 'uncommon', color: '#e6c23c', pattern: 'tiles', solid: true },
  { id: 18, key: 'green_block', name: 'Green Block', tier: 'uncommon', color: '#3fa55a', pattern: 'tiles', solid: true },
  { id: 19, key: 'white_block', name: 'White Block', tier: 'uncommon', color: '#ecebe6', pattern: 'tiles', solid: true },
  { id: 20, key: 'gold_block', name: 'Gold Block', tier: 'rare', color: '#f2c230', pattern: 'tiles', solid: true },
  { id: 21, key: 'diamond_brick', name: 'Diamond Brick', tier: 'rare', color: '#5fd8e0', pattern: 'bricks', solid: true },
  { id: 22, key: 'granite', name: 'Polished Granite', tier: 'rare', color: '#a8665a', pattern: 'ore', solid: true },
  { id: 23, key: 'stained_glass', name: 'Stained Glass', tier: 'rare', color: '#b05fd8', pattern: 'glass', solid: true, transparent: true },
  { id: 24, key: 'bookshelf', name: 'Bookshelf', tier: 'rare', color: '#8a5a34', pattern: 'books', solid: true },
  { id: 25, key: 'crystal', name: 'Crystal Block', tier: 'epic', color: '#9fe6ff', pattern: 'crystal', solid: true, emissive: true },
  { id: 26, key: 'marble_column', name: 'Marble Column', tier: 'epic', color: '#f1eee6', pattern: 'column', solid: true },
  { id: 27, key: 'lantern', name: 'Glow Lantern', tier: 'epic', color: '#ffc857', pattern: 'crystal', solid: true, emissive: true },
  { id: 28, key: 'obsidian', name: 'Obsidian', tier: 'epic', color: '#2a1f3d', pattern: 'ore', solid: true },
  { id: 29, key: 'starstone', name: 'Starstone', tier: 'legendary', color: '#1d2a6b', pattern: 'star', solid: true, emissive: true },
  { id: 30, key: 'royal_gold', name: 'Monument Gold', tier: 'legendary', color: '#ffb32c', pattern: 'column', solid: true, emissive: true },
  { id: 31, key: 'rainbow', name: 'Rainbow Block', tier: 'legendary', color: '#e04fa0', pattern: 'rainbow', solid: true, emissive: true },
  { id: 32, key: 'bedrock', name: 'Bedrock', tier: 'natural', color: '#2f2f33', pattern: 'ore', solid: true, unbreakable: true }
];

export const BLOCK_BY_ID: Record<number, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.id, b]));
export const BLOCK_BY_KEY: Record<string, BlockDef> = Object.assign(Object.create(null), Object.fromEntries(BLOCKS.map((b) => [b.key, b])));

export const TIERS: Tier[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
export const TIER_LABEL: Record<Tier, string> = {
  natural: 'Natural', common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic', legendary: 'Legendary'
};
/** Colorblind-friendly tier colors, always shown alongside the tier name (never color alone). */
export const TIER_COLOR: Record<Tier, string> = {
  natural: '#9aa0a6', common: '#c7c7c7', uncommon: '#4cc36f', rare: '#4a9dff', epic: '#b36bff', legendary: '#ff9a1f'
};

export function isRewardable(id: number): boolean {
  const b = BLOCK_BY_ID[id];
  return !!b && b.tier !== 'natural';
}
