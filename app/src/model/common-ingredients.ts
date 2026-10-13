import type { AppIngredient } from './types';

const commonIds = {
  current: [
    'tomato', 'egg', 'potato', 'green_pepper', 'pork', 'pork_tenderloin',
    'pork_belly', 'beef', 'chicken', 'chicken_breast', 'chicken_thigh',
    'chicken_wing', 'whole_seabass', 'firm_tofu', 'soft_tofu',
    'chinese_cabbage', 'cabbage', 'broccoli', 'bok_choy', 'spinach',
    'fresh_shiitake', 'dried_shiitake', 'eggplant', 'cucumber',
    'scallion', 'ginger', 'garlic', 'cooked_rice', 'dried_laver',
  ],
  pantry: [
    'light_soy_sauce', 'dark_soy_sauce', 'oyster_sauce', 'cooking_wine',
    'aromatic_vinegar', 'rice_vinegar', 'sugar', 'corn_starch',
    'potato_starch', 'sesame_oil', 'doubanjiang', 'dried_chili',
    'sichuan_pepper', 'white_pepper', 'rock_sugar', 'star_anise',
    'cinnamon', 'scallion', 'ginger', 'garlic',
  ],
} as const;

export function getCommonIngredients(ingredients: readonly AppIngredient[], location: 'current' | 'pantry'): readonly AppIngredient[] {
  const available = new Map(ingredients
    .filter((ingredient) => ingredient.selectable && !ingredient.implicit_staple)
    .map((ingredient) => [ingredient.ingredient_id, ingredient]));
  return commonIds[location].flatMap((id) => {
    const ingredient = available.get(id);
    return ingredient ? [ingredient] : [];
  });
}
