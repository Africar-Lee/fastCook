import type { Catalog, EngineInput, Equipment, Ingredient, LocalizedText, Recipe, Requirement } from '../../../packages/engine/src/types';

export type AppIngredient = Ingredient & Readonly<{ category: string; search_terms: readonly string[] }>;
export type AppRequirement = Requirement & Readonly<{ preparation?: LocalizedText }>;
export type AppRecipe = Omit<Recipe, 'requirements'> & Readonly<{
  servings: number;
  variant: Readonly<Record<string, string>>;
  source_ids: readonly string[];
  requirements: readonly AppRequirement[];
}>;
export type AppSource = Readonly<{
  source_id: string;
  provenance: Readonly<{ kind: 'original' | 'upstream' | 'contribution' | 'editorial_draft'; origin: string; locator: string }>;
  revision: Readonly<{ identifier: string }>;
  license: Readonly<{ state: 'pending' | 'verified' | 'rejected'; identifier?: string; evidence_locator?: string }>;
}>;
export type AppCatalog = Omit<Catalog, 'ingredients' | 'recipes'> & Readonly<{
  ingredients: readonly AppIngredient[];
  recipes: readonly AppRecipe[];
  pantry_templates: readonly Readonly<{ template_id: string; ingredient_ids: readonly string[] }>[];
  sources: readonly AppSource[];
}>;

export type KitchenState = Readonly<{
  schemaVersion: 1;
  datasetVersion: string;
  currentIds: readonly string[];
  pantryIds: readonly string[];
  unavailableIds: readonly string[];
  equipment: readonly Equipment[];
  equipmentConfigured: boolean;
  pantryConfigured: boolean;
  updatedAt: string | null;
}>;

export type UpdateKitchen = (update: (previous: KitchenState) => KitchenState) => void;
export type AppFilters = NonNullable<EngineInput['filters']>;
