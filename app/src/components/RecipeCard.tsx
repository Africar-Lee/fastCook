import { formatList, t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Icon, Text, useTheme } from 'react-native-paper';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import type { AppCatalog } from '../model/types';
import { courseLabels, equipmentLabels, ingredientName } from '../model/presentation';
import { isPrivateRecipeId } from '../model/private-recipes';

type Props = Readonly<{ catalog: AppCatalog; evaluation: RecipeEvaluation; onPress: () => void;
  onAdd?: () => void; selected?: boolean; addDisabled?: boolean }>;

function summaries(catalog: AppCatalog, evaluation: RecipeEvaluation): string[] {
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, ingredientName(item)]));
  const name = (id: string) => names.get(id) ?? id;
  const recipe = catalog.recipes.find((item) => item.recipe_id === evaluation.recipe_id);
  const seasoningIds = new Set(recipe?.requirements.filter((item) => item.role === 'seasoning').map((item) => item.ingredient_id));
  const missingFood = evaluation.missing_required_ingredient_ids.filter((id) => !seasoningIds.has(id));
  const missingSeasonings = evaluation.missing_required_ingredient_ids.filter((id) => seasoningIds.has(id));
  const lines: string[] = [];
  if (missingFood.length) lines.push(t('缺食材 {ingredients}', { ingredients: formatList(missingFood.map(name)) }));
  if (missingSeasonings.length) lines.push(t('缺调料 {ingredients}', { ingredients: formatList(missingSeasonings.map(name)) }));
  if (evaluation.missing_equipment.length) lines.push(t('缺厨具 {equipment}', { equipment: formatList(evaluation.missing_equipment.map((id) => equipmentLabels[id])) }));
  if (evaluation.uncertain_equipment.length) lines.push(t('确认厨具 {equipment}', { equipment: formatList(evaluation.uncertain_equipment.map((id) => equipmentLabels[id])) }));
  const uncertain = evaluation.requirements.filter((item) => item.presence === 'uncertain' && !item.omitted);
  if (uncertain.length) lines.push(t('需确认 {ingredients}', { ingredients: formatList(uncertain.map((item) => name(item.ingredient_id))) }));
  for (const item of evaluation.requirements) {
    if (item.match_kind === 'substitution' && item.used_ingredient_id && !item.omitted) lines.push(t('{used}替代{original}', { used: name(item.used_ingredient_id), original: name(item.ingredient_id) }));
  }
  const omitted = evaluation.requirements.filter((item) => item.omitted && item.importance === 'important');
  if (omitted.length) lines.push(t('省略 {ingredients}', { ingredients: formatList(omitted.map((item) => name(item.ingredient_id))) }));
  if (!evaluation.plan_valid) lines.push(t('做法组合需核对'));
  return lines;
}

export function RecipeCard({ catalog, evaluation, onPress, onAdd, selected, addDisabled }: Props) {
  useI18n();
  const theme = useTheme();
  const recipe = catalog.recipes.find((item) => item.recipe_id === evaluation.recipe_id);
  if (!recipe) return null;
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, ingredientName(item)]));
  const highlights = recipe.requirements.filter((item) => item.role === 'main' || item.role === 'secondary').slice(0, 4);
  const lines = summaries(catalog, evaluation);

  return (
    <Card mode="contained" onPress={onPress} style={[styles.card, { backgroundColor: theme.colors.surface }]} accessibilityLabel={t('{name}，{minutes}分钟，查看做法', { name: recipe.name['zh-CN'] ?? recipe.recipe_id, minutes: recipe.time_minutes })}>
      <Card.Content style={styles.content}>
        <View style={styles.heading}>
          <View style={styles.titleArea}>
            <Text variant="titleMedium" style={styles.title}>{recipe.name['zh-CN'] ?? recipe.recipe_id}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{isPrivateRecipeId(recipe.recipe_id) ? `${t('我的菜谱')} · ` : ''}{courseLabels[recipe.course]} · {t('{minutes} 分钟', { minutes: recipe.time_minutes })}{recipe.spicy_level > 0 ? ` · ${t('有辣味')}` : ''}</Text>
          </View>
          <Icon source="chevron-right" size={22} color={theme.colors.onSurfaceVariant} />
        </View>
        <View style={styles.ingredients}>
          {highlights.map((item) => <Chip key={item.requirement_id} compact textStyle={styles.chipText} style={{ backgroundColor: theme.colors.surfaceVariant }}>{names.get(item.ingredient_id) ?? item.ingredient_id}</Chip>)}
        </View>
        {lines.slice(0, 3).map((line) => <Text key={line} variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{line}</Text>)}
      </Card.Content>
      {onAdd && <Card.Actions><Button icon={selected ? 'check' : 'plus'} disabled={selected || addDisabled}
        onPress={event => { event.stopPropagation(); onAdd(); }}>{t(selected ? '已加入' : '加入这顿')}</Button></Card.Actions>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20 },
  content: { gap: 10, paddingVertical: 18 },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleArea: { flex: 1, gap: 6 },
  title: { fontWeight: '700' },
  ingredients: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chipText: { fontSize: 11, lineHeight: 16 },
});
