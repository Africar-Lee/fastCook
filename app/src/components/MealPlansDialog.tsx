import { t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Button, Card, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { generateMealPlans } from '../../../packages/engine/src/meal';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import type { AppCatalog, KitchenState } from '../model/types';
import { textOf } from '../model/presentation';
import { isPrivateRecipeId } from '../model/private-recipes';
import { CountStepper } from './CountStepper';

type Props = Readonly<{ catalog: AppCatalog; state: KitchenState; candidates: readonly RecipeEvaluation[];
  onDismiss: () => void; onAdopt: (recipeIds: readonly string[], people: number) => void }>;

export function MealPlansDialog({ catalog, state, candidates, onDismiss, onAdopt }: Props) {
  useI18n();
  const theme = useTheme();
  const [people, setPeople] = useState(state.mealRecipeIds.length ? state.mealPeople : state.defaultPeople);
  const plans = useMemo(() => generateMealPlans(catalog, candidates, {
    people, burnerCount: state.burnerCount, currentIngredientIds: state.currentIds,
  }), [catalog, candidates, people, state.burnerCount, state.currentIds]);
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>{t('帮我配一顿')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView contentContainerStyle={styles.content}>
      <CountStepper label={t('用餐人数')} value={people} min={1} max={12} onChange={setPeople} />
      {plans.error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(plans.error.message)}</Text>}
      {plans.data?.length === 0 && <Text>{t('现有食材暂时配不齐一顿，可以先选一道菜加入这顿。')}</Text>}
      {plans.data?.map((plan, index) => <Card key={plan.id} mode="outlined">
        <Card.Content style={styles.plan}>
          <Text variant="titleMedium">{t('搭配 {number}', { number: index + 1 })}</Text>
          {plan.recipe_ids.map(id => <Text key={id}>{textOf(catalog.recipes.find(recipe => recipe.recipe_id === id)?.name)}{isPrivateRecipeId(id) ? ` · ${t('我的菜谱')}` : ''}</Text>)}
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
            {t('预计 {minutes} 分钟 · 用到 {count} 种手头食材', { minutes: plan.estimated_minutes, count: plan.current_ingredient_count })}{plan.caveat_count > 0 ? ` · ${t('{count} 道有用料调整', { count: plan.caveat_count })}` : ''}
          </Text>
        </Card.Content>
        <Card.Actions><Button onPress={() => onAdopt(plan.recipe_ids, people)}>{t('采用这套')}</Button></Card.Actions>
      </Card>)}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>{t('关闭')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '92%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { flexShrink: 1, maxHeight: 520 }, content: { paddingVertical: 16, gap: 16 }, plan: { gap: 8 },
});
