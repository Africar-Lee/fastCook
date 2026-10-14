export function localizeIngredients(ingredients, translations) {
  if (!translations || typeof translations !== 'object' || Array.isArray(translations)) {
    throw new Error('Ingredient translations must be an object.');
  }
  const ids = new Set(ingredients.map(ingredient => ingredient.ingredient_id));
  if (Object.keys(translations).some(id => !ids.has(id))) throw new Error('Unknown ingredient translation ID.');
  return ingredients.map(ingredient => {
    const entry = translations[ingredient.ingredient_id];
    if (!entry || typeof entry.name !== 'string' || !entry.name.trim()
      || (entry.aliases !== undefined && (!Array.isArray(entry.aliases)
        || entry.aliases.some(alias => typeof alias !== 'string' || !alias.trim())))) {
      throw new Error(`Invalid English translation for ${ingredient.ingredient_id}.`);
    }
    return { ...ingredient,
      names: { ...ingredient.names, en: entry.name },
      aliases: { ...ingredient.aliases, en: (entry.aliases ?? []).map(text => ({ text, resolution: 'automatic' })) },
    };
  });
}
