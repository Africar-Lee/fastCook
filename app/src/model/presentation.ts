import { getLocale, localizedLabels, t } from '../i18n/core.ts';
import type { Catalog, Course, Equipment, Importance, LocalizedText, Quantity, Tier } from '../../../packages/engine/src/types';

export const equipmentLabels: Readonly<Record<Equipment, string>> = localizedLabels({
  wok: '炒锅', frying_pan: '平底锅', pot: '汤锅', steamer: '蒸锅', oven: '烤箱',
  air_fryer: '空气炸锅', rice_cooker: '电饭煲', microwave: '微波炉',
  pressure_cooker: '压力锅', electric_steamer: '电蒸锅',
});

export const tierLabels: Readonly<Record<Tier, string>> = localizedLabels({
  ready: '原料齐全', caveat: '可做，有风味调整', needs_confirmation: '需要确认',
  one_missing: '再补一样', insufficient: '还需补齐',
});

export const courseLabels: Readonly<Record<Course, string>> = localizedLabels({
  meat: '荤菜', veg: '素菜', soup: '汤', staple: '主食', cold: '凉菜',
});

export const importanceLabels: Readonly<Record<Importance, string>> = localizedLabels({
  required: '必需', important: '影响风味', optional: '可选',
});

export function textOf(text: LocalizedText | undefined): string {
  return text?.['zh-CN'] ?? Object.values(text ?? {})[0] ?? '';
}

export function ingredientName(ingredient: Readonly<{ ingredient_id: string; names: LocalizedText }>): string {
  return ingredient.names[getLocale()] || textOf(ingredient.names) || ingredient.ingredient_id;
}

export function nameOf(catalog: Catalog, ingredientId: string): string {
  const ingredient = catalog.ingredients.find(item => item.ingredient_id === ingredientId);
  return ingredient ? ingredientName(ingredient) : ingredientId;
}

export function formatQuantity(quantity: Quantity | undefined): string {
  if (!quantity) return t('用量见替代说明');
  if (quantity.unit === 'to_taste') return t('适量');
  const unit = ({ g: '克', ml: '毫升', piece: '个', tbsp: '大匙', tsp: '小匙' } as Readonly<Record<string, string>>)[quantity.unit] ?? quantity.unit;
  const number = (value: number) => String(Math.round(value * 100) / 100);
  const amount = quantity.value === undefined
    ? `${number(quantity.min ?? 0)}–${number(quantity.max ?? quantity.min ?? 0)}`
    : number(quantity.value);
  const spoon = quantity.unit === 'tbsp' ? '（每匙 15 毫升）' : quantity.unit === 'tsp' ? '（每匙 5 毫升）' : '';
  return `${amount} ${t(unit)}${t(spoon)}`;
}
