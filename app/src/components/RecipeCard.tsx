import { StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Icon, Text, useTheme } from 'react-native-paper';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import type { AppCatalog } from '../model/types';
import { courseLabels, equipmentLabels } from '../model/presentation';

type Props = Readonly<{ catalog: AppCatalog; evaluation: RecipeEvaluation; onPress: () => void;
  onAdd?: () => void; selected?: boolean; addDisabled?: boolean }>;

function summaries(catalog: AppCatalog, evaluation: RecipeEvaluation): string[] {
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, item.names['zh-CN'] ?? item.ingredient_id]));
  const name = (id: string) => names.get(id) ?? id;
  const recipe = catalog.recipes.find((item) => item.recipe_id === evaluation.recipe_id);
  const seasoningIds = new Set(recipe?.requirements.filter((item) => item.role === 'seasoning').map((item) => item.ingredient_id));
  const missingFood = evaluation.missing_required_ingredient_ids.filter((id) => !seasoningIds.has(id));
  const missingSeasonings = evaluation.missing_required_ingredient_ids.filter((id) => seasoningIds.has(id));
  const lines: string[] = [];
  if (missingFood.length) lines.push(`缺食材 ${missingFood.map(name).join('、')}`);
  if (missingSeasonings.length) lines.push(`缺调料 ${missingSeasonings.map(name).join('、')}`);
  if (evaluation.missing_equipment.length) lines.push(`缺厨具 ${evaluation.missing_equipment.map((id) => equipmentLabels[id]).join('、')}`);
  if (evaluation.uncertain_equipment.length) lines.push(`确认厨具 ${evaluation.uncertain_equipment.map((id) => equipmentLabels[id]).join('、')}`);
  const uncertain = evaluation.requirements.filter((item) => item.presence === 'uncertain' && !item.omitted);
  if (uncertain.length) lines.push(`需确认 ${uncertain.map((item) => name(item.ingredient_id)).join('、')}`);
  for (const item of evaluation.requirements) {
    if (item.match_kind === 'substitution' && item.used_ingredient_id && !item.omitted) lines.push(`${name(item.used_ingredient_id)}替代${name(item.ingredient_id)}`);
  }
  const omitted = evaluation.requirements.filter((item) => item.omitted && item.importance === 'important');
  if (omitted.length) lines.push(`省略 ${omitted.map((item) => name(item.ingredient_id)).join('、')}`);
  if (!evaluation.plan_valid) lines.push('做法组合需核对');
  return lines;
}

export function RecipeCard({ catalog, evaluation, onPress, onAdd, selected, addDisabled }: Props) {
  const theme = useTheme();
  const recipe = catalog.recipes.find((item) => item.recipe_id === evaluation.recipe_id);
  if (!recipe) return null;
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, item.names['zh-CN'] ?? item.ingredient_id]));
  const highlights = recipe.requirements.filter((item) => item.role === 'main' || item.role === 'secondary').slice(0, 4);
  const lines = summaries(catalog, evaluation);

  return (
    <Card mode="contained" onPress={onPress} style={[styles.card, { backgroundColor: theme.colors.surface }]} accessibilityLabel={`${recipe.name['zh-CN']}，${recipe.time_minutes}分钟，查看做法`}>
      <Card.Content style={styles.content}>
        <View style={styles.heading}>
          <View style={styles.titleArea}>
            <Text variant="titleMedium" style={styles.title}>{recipe.name['zh-CN'] ?? recipe.recipe_id}</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{courseLabels[recipe.course]} · {recipe.time_minutes} 分钟{recipe.spicy_level > 0 ? ' · 有辣味' : ''}</Text>
          </View>
          <Icon source="chevron-right" size={22} color={theme.colors.onSurfaceVariant} />
        </View>
        <View style={styles.ingredients}>
          {highlights.map((item) => <Chip key={item.requirement_id} compact textStyle={styles.chipText} style={{ backgroundColor: theme.colors.surfaceVariant }}>{names.get(item.ingredient_id) ?? item.ingredient_id}</Chip>)}
        </View>
        {lines.slice(0, 3).map((line) => <Text key={line} variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{line}</Text>)}
      </Card.Content>
      {onAdd && <Card.Actions><Button icon={selected ? 'check' : 'plus'} disabled={selected || addDisabled}
        onPress={event => { event.stopPropagation(); onAdd(); }}>{selected ? '已加入' : '加入这顿'}</Button></Card.Actions>}
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
