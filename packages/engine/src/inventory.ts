import type { EngineInput, Equipment, InventoryItem, InventorySnapshot, PreparedCatalog, Result } from './types.ts';

const equipmentNames = new Set(['wok', 'frying_pan', 'pot', 'steamer', 'oven', 'air_fryer', 'rice_cooker', 'microwave', 'pressure_cooker', 'electric_steamer']);
const courseNames = new Set(['meat', 'veg', 'soup', 'staple', 'cold']);

export function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function stringList(value: unknown, maximum = 512): value is string[] {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === 'string' && item.length > 0 && item.length <= 96);
}

function failure(path: string, message: string): Result<never> {
  return { data: null, error: { code: 'input.invalid', path, message } };
}

function validateItems(prepared: PreparedCatalog, value: unknown): Result<true> {
  if (!Array.isArray(value) || value.length > 512) return failure('inventory.items', '食材清单必须为数组且不超过 512 项，请减少条目后重试。');
  const identities = new Map<string, string>();
  for (const [index, item] of value.entries()) {
    const path = `inventory.items[${index}]`;
    if (!record(item) || !onlyKeys(item, ['item_id', 'ingredient_id', 'location'])) return failure(path, '库存条目字段无效，请重新选择食材。');
    if (typeof item.item_id !== 'string' || !/^[a-zA-Z0-9_-]{1,96}$/.test(item.item_id)) return failure(path, '库存条目标识无效，请重新保存该条目。');
    if (typeof item.ingredient_id !== 'string' || !prepared.ingredients.get(item.ingredient_id)?.selectable) return failure(path, '找不到可选的标准原料，请重新选择食材。');
    if (item.location !== 'current' && item.location !== 'pantry') return failure(path, '库存位置须为当次食材或调料柜，请重新保存该条目。');
    const identity = JSON.stringify([item.ingredient_id, item.location]);
    if (identities.has(item.item_id) && identities.get(item.item_id) !== identity) return failure(path, '同一库存标识对应了不同条目，请修正重复标识。');
    identities.set(item.item_id, identity);
  }
  return { data: true, error: null };
}

function validateEquipment(value: unknown): Result<true> {
  if (value === undefined) return { data: true, error: null };
  if (!record(value) || !onlyKeys(value, ['available', 'unavailable'])) return failure('inventory.equipment', '厨具状态无效，请重新选择已有及缺少的厨具。');
  if (!stringList(value.available, 10) || !stringList(value.unavailable, 10)) return failure('inventory.equipment', '厨具清单无效，请重新选择。');
  if ([...value.available, ...value.unavailable].some((name) => !equipmentNames.has(name))) return failure('inventory.equipment', '厨具清单包含未知类型，请重新选择。');
  if (value.available.some((name) => (value.unavailable as string[]).includes(name))) return failure('inventory.equipment', '同一厨具被同时标为已有和缺少，请确认状态。');
  return { data: true, error: null };
}

function validateFilters(value: unknown): Result<true> {
  if (value === undefined) return { data: true, error: null };
  if (!record(value) || !onlyKeys(value, ['max_time_minutes', 'max_spicy_level', 'courses'])) return failure('filters', '筛选字段无效，请重新设置筛选条件。');
  if (value.max_time_minutes !== undefined && (typeof value.max_time_minutes !== 'number' || !Number.isFinite(value.max_time_minutes) || value.max_time_minutes <= 0 || value.max_time_minutes > 1440)) return failure('filters.max_time_minutes', '最长耗时须在 0 到 1440 分钟之间，请调整筛选。');
  if (value.max_spicy_level !== undefined && (!Number.isInteger(value.max_spicy_level) || Number(value.max_spicy_level) < 0 || Number(value.max_spicy_level) > 3)) return failure('filters.max_spicy_level', '辣度须为 0 到 3 的整数，请重新选择。');
  if (value.courses !== undefined && (!stringList(value.courses, 5) || value.courses.some((course) => !courseNames.has(course)))) return failure('filters.courses', '菜品类别无效，请重新选择类别。');
  return { data: true, error: null };
}

export function validateInput(prepared: PreparedCatalog, value: unknown): Result<EngineInput> {
  if (!record(value) || !onlyKeys(value, ['inventory', 'filters', 'confirmations']) || !record(value.inventory)) return failure('input', '推荐输入无效，请重新加载食材清单。');
  const inventory = value.inventory;
  if (!onlyKeys(inventory, ['items', 'unavailable_ingredient_ids', 'use_implicit_staples', 'equipment'])) return failure('inventory', '库存包含未知字段，请重新加载清单。');
  const items = validateItems(prepared, inventory.items);
  if (items.error) return items;
  const unavailable = inventory.unavailable_ingredient_ids;
  if (unavailable !== undefined && (!stringList(unavailable) || unavailable.some((id) => !prepared.ingredients.get(id)?.selectable))) return failure('inventory.unavailable_ingredient_ids', '缺少清单含无效原料，请重新选择。');
  if (inventory.use_implicit_staples !== undefined && typeof inventory.use_implicit_staples !== 'boolean') return failure('inventory.use_implicit_staples', '常备油盐水设置须为布尔值，请重新设置。');
  const equipment = validateEquipment(inventory.equipment);
  if (equipment.error) return equipment;
  const filters = validateFilters(value.filters);
  if (filters.error) return filters;
  if (value.confirmations !== undefined && (!Array.isArray(value.confirmations) || value.confirmations.length > 256 || value.confirmations.some((key) => typeof key !== 'string' || key.length > 131072))) return failure('confirmations', '规则确认记录无效或过大，请重新确认替代用法。');
  return { data: value as EngineInput, error: null };
}

export function isExcluded(prepared: PreparedCatalog, unavailable: ReadonlySet<string>, ingredientId: string): boolean {
  return unavailable.has(ingredientId) || [...(prepared.ancestors.get(ingredientId) ?? [])].some((id) => unavailable.has(id));
}

function compareItems(left: InventoryItem, right: InventoryItem): number {
  const locations = { current: 0, pantry: 1, implicit: 2 };
  return locations[left.location] - locations[right.location] || compareIds(left.item_id, right.item_id);
}

function snapshot(items: readonly InventoryItem[], unavailable: ReadonlySet<string>, availableEquipment: ReadonlySet<Equipment>, unavailableEquipment: ReadonlySet<Equipment>): InventorySnapshot {
  const ordered = [...items].sort((left, right) => compareIds(left.ingredient_id, right.ingredient_id));
  const signature = JSON.stringify([
    ordered.map((item) => [item.item_id, item.ingredient_id, item.location]),
    [...unavailable].sort(compareIds), [...availableEquipment].sort(compareIds), [...unavailableEquipment].sort(compareIds),
  ]);
  return { items: ordered, unavailable, availableEquipment, unavailableEquipment, signature };
}

export function buildInventory(prepared: PreparedCatalog, input: EngineInput): InventorySnapshot {
  const unavailable = new Set(input.inventory.unavailable_ingredient_ids ?? []);
  const items = new Map<string, InventoryItem>();
  for (const item of [...input.inventory.items].sort(compareItems)) {
    if (!isExcluded(prepared, unavailable, item.ingredient_id) && !items.has(item.ingredient_id)) items.set(item.ingredient_id, { ...item });
  }
  if (input.inventory.use_implicit_staples !== false) {
    for (const ingredient of prepared.ingredients.values()) {
      const id = ingredient.ingredient_id;
      if (ingredient.implicit_staple && !items.has(id) && !isExcluded(prepared, unavailable, id)) items.set(id, { item_id: `implicit:${id}`, ingredient_id: id, location: 'implicit' });
    }
  }
  return snapshot([...items.values()], unavailable, new Set(input.inventory.equipment?.available ?? []), new Set(input.inventory.equipment?.unavailable ?? []));
}

export function addPurchase(prepared: PreparedCatalog, inventory: InventorySnapshot, ingredientId: string): InventorySnapshot {
  const unavailable = new Set([...inventory.unavailable].filter((id) => id !== ingredientId && !prepared.ancestors.get(ingredientId)?.has(id)));
  const items = [...inventory.items.filter((item) => item.ingredient_id !== ingredientId), { item_id: `purchase:${ingredientId}`, ingredient_id: ingredientId, location: 'current' as const }];
  return snapshot(items, unavailable, inventory.availableEquipment, inventory.unavailableEquipment);
}

export function confirmationKey(prepared: PreparedCatalog, recipeId: string, ruleId: string, inventory: InventorySnapshot): string {
  const recipe = prepared.catalog.recipes.find((item) => item.recipe_id === recipeId)!;
  const rule = prepared.catalog.substitution_rules.find((item) => item.rule_id === ruleId)!;
  const related = new Set([...recipe.requirements.map((item) => item.ingredient_id),
    rule.substitute_ingredient_id, ...rule.conditions.requires_available_ingredient_ids]);
  const relevant = (id: string) => [...related].some((target) => target === id
    || prepared.ancestors.get(id)?.has(target) || prepared.ancestors.get(target)?.has(id));
  const equipment = new Set(recipe.equipment_slots.map((slot) => slot.equipment));
  const context = [
    inventory.items.filter((item) => relevant(item.ingredient_id)).map((item) => [item.item_id, item.ingredient_id, item.location]),
    [...inventory.unavailable].filter(relevant).sort(compareIds),
    [...inventory.availableEquipment].filter((item) => equipment.has(item)).sort(compareIds),
    [...inventory.unavailableEquipment].filter((item) => equipment.has(item)).sort(compareIds),
  ];
  return JSON.stringify([prepared.catalog.dataset_version, recipeId, ruleId, context]);
}
