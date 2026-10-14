import { textOf } from './presentation.ts';
import type { AppCatalog } from './types';

export const reportCategoryLabels = {
  ingredients: '食材用量', steps: '做法步骤', matching: '匹配结果', other: '其他',
} as const;

export const MAX_REPORT_DESCRIPTION_LENGTH = 2000;

export type RecipeReport = Readonly<{
  schema_version: 1;
  app_version: string;
  dataset_version: string;
  recipe: Readonly<{ recipe_id: string; dish_id: string; name: string; source_ids: readonly string[] }>;
  issue: Readonly<{ category: keyof typeof reportCategoryLabels; description: string }>;
}>;

type ReportResult = Readonly<{ data: RecipeReport; error: null }> | Readonly<{ data: null; error: string }>;

export function createRecipeReport(catalog: AppCatalog, recipeId: string, appVersion: string, input: unknown): ReportResult {
  if (typeof recipeId !== 'string' || !recipeId || recipeId.length > 128) {
    return { data: null, error: '菜谱编号无效，请返回重新选择菜谱。' };
  }
  const recipe = catalog.recipes.find(item => item.recipe_id === recipeId);
  if (!recipe) return { data: null, error: '这份菜谱已不可用，请返回重新选择。' };
  if (typeof appVersion !== 'string' || !appVersion.trim() || appVersion.length > 128) {
    return { data: null, error: '应用版本无法读取，请重新打开应用后重试。' };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { data: null, error: '问题内容无效，请重新填写。' };
  }
  const { category, description } = input as Record<string, unknown>;
  if (typeof category !== 'string' || !Object.hasOwn(reportCategoryLabels, category)) {
    return { data: null, error: '请选择问题类型。' };
  }
  if (typeof description !== 'string' || !description.trim()) {
    return { data: null, error: '请填写问题描述。' };
  }
  if (description.length > MAX_REPORT_DESCRIPTION_LENGTH) {
    return { data: null, error: `问题描述最多 ${MAX_REPORT_DESCRIPTION_LENGTH} 字，请缩短后重试。` };
  }
  return { data: {
    schema_version: 1, app_version: appVersion, dataset_version: catalog.dataset_version,
    recipe: { recipe_id: recipe.recipe_id, dish_id: recipe.dish_id, name: textOf(recipe.name), source_ids: [...recipe.source_ids] },
    issue: { category: category as RecipeReport['issue']['category'], description: description.trim() },
  }, error: null };
}
