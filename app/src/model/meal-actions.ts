import type { AppCatalog, KitchenState } from './types';

export function clearMeal(state: KitchenState): KitchenState {
  return { ...state, mealRecipeIds: [], mealPeople: state.defaultPeople, sharedIngredientIds: [] };
}

export function addMealRecipe(state: KitchenState, catalog: AppCatalog, recipeId: string): KitchenState {
  const recipe = catalog.recipes.find(item => item.recipe_id === recipeId);
  if (!recipe || state.mealRecipeIds.includes(recipeId) || state.mealRecipeIds.length >= 5) return state;
  const selectedDishes = new Set(catalog.recipes.filter(item => state.mealRecipeIds.includes(item.recipe_id)).map(item => item.dish_id));
  if (selectedDishes.has(recipe.dish_id)) return state;
  return { ...state, mealRecipeIds: [...state.mealRecipeIds, recipeId],
    mealPeople: state.mealRecipeIds.length ? state.mealPeople : state.defaultPeople, sharedIngredientIds: [] };
}

export function removeMealRecipe(state: KitchenState, recipeId: string): KitchenState {
  const mealRecipeIds = state.mealRecipeIds.filter(id => id !== recipeId);
  if (mealRecipeIds.length === state.mealRecipeIds.length) return state;
  return mealRecipeIds.length ? { ...state, mealRecipeIds, sharedIngredientIds: [] } : clearMeal(state);
}

export function replaceMealRecipe(state: KitchenState, catalog: AppCatalog, oldId: string, newId: string): KitchenState {
  const recipe = catalog.recipes.find(item => item.recipe_id === newId);
  if (!recipe || !state.mealRecipeIds.includes(oldId) || oldId === newId) return state;
  const otherIds = state.mealRecipeIds.filter(id => id !== oldId);
  if (catalog.recipes.some(item => otherIds.includes(item.recipe_id) && item.dish_id === recipe.dish_id)) return state;
  return { ...state, mealRecipeIds: state.mealRecipeIds.map(id => id === oldId ? newId : id), sharedIngredientIds: [] };
}

export function adoptMeal(state: KitchenState, catalog: AppCatalog, recipeIds: readonly string[], people: number): KitchenState {
  if (!Number.isInteger(people) || people < 1 || people > 12 || recipeIds.length < 2 || recipeIds.length > 5) return state;
  const recipes = recipeIds.map(id => catalog.recipes.find(recipe => recipe.recipe_id === id));
  if (recipes.some(recipe => !recipe) || new Set(recipes.map(recipe => recipe!.dish_id)).size !== recipeIds.length) return state;
  return { ...state, mealRecipeIds: [...recipeIds], mealPeople: people, sharedIngredientIds: [] };
}
