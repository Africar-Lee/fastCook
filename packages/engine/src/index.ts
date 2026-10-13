import { buildInventory, validateInput } from './inventory.ts';
import { createNameResolver } from './names.ts';
import { prepareCatalog } from './prepare.ts';
import { recommend } from './recommend.ts';
import type { Catalog, NameResolution, Recommendations, Result } from './types.ts';

export type * from './types.ts';

export type RecipeEngine = Readonly<{
  recommend: (input: unknown) => Result<Recommendations>;
  resolveIngredient: (query: unknown, locale?: unknown) => Result<NameResolution>;
}>;

export function createEngine(catalog: Catalog, options: { allowDraft?: boolean; maxPlanCombinations?: number } = {}): Result<RecipeEngine> {
  const prepared = prepareCatalog(catalog, options);
  if (prepared.error) return prepared;
  const context = prepared.data;
  return {
    data: {
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
