import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Card, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { generateMealPlans } from '../../../packages/engine/src/meal';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import type { AppCatalog, KitchenState } from '../model/types';
import { textOf } from '../model/presentation';
import { CountStepper } from './CountStepper';

type Props = Readonly<{ catalog: AppCatalog; state: KitchenState; candidates: readonly RecipeEvaluation[];
  onDismiss: () => void; onAdopt: (recipeIds: readonly string[], people: number) => void }>;

export function MealPlansDialog({ catalog, state, candidates, onDismiss, onAdopt }: Props) {
  const theme = useTheme();
  const [people, setPeople] = useState(state.mealRecipeIds.length ? state.mealPeople : state.defaultPeople);
  const plans = useMemo(() => generateMealPlans(catalog, candidates, {
    people, burnerCount: state.burnerCount, currentIngredientIds: state.currentIds,
  }), [catalog, candidates, people, state.burnerCount, state.currentIds]);
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>帮我配一顿</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      <CountStepper label="用餐人数" value={people} min={1} max={12} onChange={setPeople} />
      {plans.error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{plans.error.message}</Text>}
      {plans.data?.length === 0 && <Text>现有食材暂时配不齐一顿，可以先选一道菜加入这顿。</Text>}
      {plans.data?.map((plan, index) => <Card key={plan.id} mode="outlined">
        <Card.Content style={styles.plan}>
          <Text variant="titleMedium">搭配 {index + 1}</Text>
          {plan.recipe_ids.map(id => <Text key={id}>{textOf(catalog.recipes.find(recipe => recipe.recipe_id === id)?.name)}</Text>)}
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            预计 {plan.estimated_minutes} 分钟 · 用到 {plan.current_ingredient_count} 种手头食材{plan.caveat_count > 0 ? ` · ${plan.caveat_count} 道有用料调整` : ''}
          </Text>
        </Card.Content>
        <Card.Actions><Button onPress={() => onAdopt(plan.recipe_ids, people)}>采用这套</Button></Card.Actions>
      </Card>)}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>关闭</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '92%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { flexShrink: 1, maxHeight: 520 }, content: { paddingVertical: 16, gap: 16 }, plan: { gap: 8 },
});
