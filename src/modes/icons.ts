/** Icon names a space can use (rendered with lucide in src/ui/icons.tsx). */
export const SPACE_ICON_NAMES = [
  'brain',
  'code',
  'bot',
  'bar-chart',
  'database',
  'coffee',
  'leaf',
  'music',
  'server',
  'layers',
  'shield',
  'smartphone',
  'cloud',
  'terminal',
  'cpu',
  'calculator',
  'atom',
  'book-open',
  'graduation-cap',
  'languages',
  'dumbbell',
  'chef-hat',
  'camera',
  'trending-up',
  'guitar',
  'crown',
  'gamepad',
  'mic',
  'palette',
  'globe',
  'sparkles',
] as const;

export type SpaceIconName = (typeof SPACE_ICON_NAMES)[number];

export const isSpaceIcon = (value: unknown): value is SpaceIconName => SPACE_ICON_NAMES.includes(value as SpaceIconName);

const FROM_EMOJI: Record<string, SpaceIconName> = {
  '🧠': 'brain',
  '💻': 'code',
  '🤖': 'bot',
  '📊': 'bar-chart',
  '🗄️': 'database',
  '☕': 'coffee',
  '🌿': 'leaf',
  '🎵': 'music',
  '🎶': 'music',
  '🧮': 'calculator',
  '🔬': 'atom',
  '🎨': 'palette',
  '📐': 'calculator',
  '🌍': 'globe',
  '🎸': 'guitar',
  '📝': 'book-open',
};

export const iconForEmoji = (emoji: string | undefined): SpaceIconName => FROM_EMOJI[emoji ?? ''] ?? 'sparkles';
