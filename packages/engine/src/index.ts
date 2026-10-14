import { buildInventory, validateInput } from './inventory.ts';
import { createNameResolver } from './names.ts';
import { prepareCatalog } from './prepare.ts';
import { recommend } from './recommend.ts';
import type { Catalog, NameResolution, RecipeEvaluation, Recommendations, Result } from './types.ts';

export type * from './types.ts';
export * from './meal.ts';

export type RecipeEngine = Readonly<{
  recommend: (input: unknown) => Result<Recommendations>;
  evaluateRecipe: (recipeId: unknown, input: unknown) => Result<RecipeEvaluation>;
  resolveIngredient: (query: unknown, locale?: unknown) => Result<NameResolution>;
}>;

export function createEngine(catalog: Catalog, options: { allowDraft?: boolean; maxPlanCombinations?: number } = {}): Result<RecipeEngine> {
  const prepared = prepareCatalog(catalog, options);
  if (prepared.error) return prepared;
  const context = prepared.data;
  return {
    data: {
      evaluateRecipe(recipeId: unknown, input: unknown) {
        const recipe = typeof recipeId === 'string' ? context.catalog.recipes.find(item => item.recipe_id === recipeId) : undefined;
        if (!recipe) return { data: null, error: {
          code: 'input.unknown_recipe', path: '/recipeId', message: '菜谱不存在，请重新选择。',
        } };
        const validated = validateInput(context, input);
        if (validated.error) return validated;
        const selectedContext = { ...context, catalog: { ...context.catalog, recipes: [recipe] } };
        const result = recommend(selectedContext, { ...validated.data, filters: undefined }, buildInventory(context, validated.data));
        return { data: result.dishes[0]!, error: null };
      },
      recommend(input: unknown) {
        const validated = validateInput(context, input);
        if (validated.error) return validated;
        return { data: recommend(context, validated.data, buildInventory(context, validated.data)), error: null };
      },
      resolveIngredient: createNameResolver(context),
    },
    error: null,
  };
}
