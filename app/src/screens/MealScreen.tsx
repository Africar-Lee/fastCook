import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Card, Dialog, Portal, Text, useTheme } from 'react-native-paper';
import { defaultMealPatterns, estimateMealMinutes, findMealConflicts, rankMealCandidates } from '../../../packages/engine/src/meal';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import { CountStepper } from '../components/CountStepper';
import { clearMeal, removeMealRecipe, replaceMealRecipe } from '../model/meal-actions';
import { courseLabels, nameOf, textOf, tierLabels } from '../model/presentation';
import type { AppCatalog, KitchenState, UpdateKitchen } from '../model/types';

type Props = Readonly<{ catalog: AppCatalog; state: KitchenState; update: UpdateKitchen;
  evaluations: readonly RecipeEvaluation[]; candidates: readonly RecipeEvaluation[];
  onBack: () => void; onOpenRecipe: (recipeId: string) => void; onAutoPlan: () => void }>;

function ReplacementDialog({ catalog, state, evaluations, candidates, recipeId, onDismiss, onReplace }: Readonly<{
  catalog: AppCatalog; state: KitchenState; evaluations: readonly RecipeEvaluation[]; candidates: readonly RecipeEvaluation[];
  recipeId: string; onDismiss: () => void; onReplace: (id: string) => void;
}>) {
  const theme = useTheme();
  const remaining = evaluations.filter(item => item.recipe_id !== recipeId);
  const selectedDishes = new Set(evaluations.map(item => item.dish_id));
  const available = candidates.filter(item => !selectedDishes.has(item.dish_id) && (item.tier === 'ready' || item.tier === 'caveat'));
  const ranked = rankMealCandidates(catalog, available, remaining, { people: state.mealPeople });
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>换一道</Dialog.Title>
    <Dialog.ScrollArea style={styles.dialogScroll}><ScrollView contentContainerStyle={styles.replacements}>
      {!ranked.length && <Text>暂无其他可做的菜，可以返回添加食材。</Text>}
      {ranked.map(item => {
        const recipe = catalog.recipes.find(recipe => recipe.recipe_id === item.recipe_id)!;
        const conflicts = findMealConflicts(catalog, [...remaining, item]);
        return <Card key={item.recipe_id} mode="outlined">
          <Card.Content style={styles.compact}>
            <Text variant="titleMedium">{textOf(recipe.name)}</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>{courseLabels[recipe.course]} · {recipe.time_minutes} 分钟</Text>
            {conflicts.length > 0 && <Text style={{ color: theme.colors.error }}>共用{conflicts.map(conflict => nameOf(catalog, conflict.ingredient_id)).join('、')}</Text>}
          </Card.Content>
          <Card.Actions><Button onPress={() => onReplace(item.recipe_id)}>换成这道</Button></Card.Actions>
        </Card>;
      })}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>取消</Button></Dialog.Actions>
  </Dialog></Portal>;
}

export function MealScreen({ catalog, state, update, evaluations, candidates, onBack, onOpenRecipe, onAutoPlan }: Props) {
  const theme = useTheme();
  const [replacing, setReplacing] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const conflicts = findMealConflicts(catalog, evaluations);
  const estimate = estimateMealMinutes(catalog, state.mealRecipeIds, state.burnerCount);
  const patterns = defaultMealPatterns(state.mealPeople);
  const dishCount = Math.min(...patterns.map(pattern => pattern.courses.length));
  const changePeople = (people: number) => update(previous => ({ ...previous, mealPeople: people, sharedIngredientIds: [] }));
  return <View style={styles.root}>
    <Appbar.Header statusBarHeight={0}><Appbar.BackAction onPress={onBack} accessibilityLabel="返回推荐" />
      <Appbar.Content title="这顿饭" />{state.mealRecipeIds.length > 0 && <Appbar.Action icon="delete-outline" onPress={() => setClearing(true)} accessibilityLabel="清空这顿" />}
    </Appbar.Header>
    <ScrollView contentContainerStyle={styles.page}>
      <CountStepper label="这顿人数" value={state.mealPeople} min={1} max={12} onChange={changePeople} />
      <View style={styles.row}>
        <Text style={styles.grow}>{state.mealRecipeIds.length} 道菜{state.mealRecipeIds.length > 0 && estimate !== null ? ` · 预计 ${estimate} 分钟` : ''}</Text>
        <Button compact onPress={onAutoPlan}>帮我配一顿</Button>
      </View>
      {state.mealRecipeIds.length < dishCount && <Text style={{ color: theme.colors.onSurfaceVariant }}>还可搭配 {dishCount - state.mealRecipeIds.length} 道</Text>}
      {state.mealRecipeIds.map(recipeId => {
        const recipe = catalog.recipes.find(item => item.recipe_id === recipeId)!;
        const evaluation = evaluations.find(item => item.recipe_id === recipeId);
        const feasible = evaluation?.tier === 'ready' || evaluation?.tier === 'caveat';
        return <Card key={recipeId} mode="contained" style={{ backgroundColor: theme.colors.surface }}>
          <Card.Content style={styles.compact}>
            <Text variant="titleLarge">{textOf(recipe.name)}</Text>
            <Text style={{ color: theme.colors.onSurfaceVariant }}>{courseLabels[recipe.course]} · {recipe.time_minutes} 分钟</Text>
            <Text style={{ color: feasible ? theme.colors.onSurfaceVariant : theme.colors.error }}>
              {evaluation ? tierLabels[evaluation.tier] : '食材状态需要重新检查'}
            </Text>
          </Card.Content>
          <Card.Actions>
            <Button compact onPress={() => {
              update(previous => removeMealRecipe(previous, recipeId));
              if (state.mealRecipeIds.length === 1) onBack();
            }}>移除</Button>
            <Button compact onPress={() => setReplacing(recipeId)}>换一道</Button>
            <Button mode="contained-tonal" onPress={() => onOpenRecipe(recipeId)}>看做法</Button>
          </Card.Actions>
        </Card>;
      })}
      {conflicts.map(conflict => {
        const shared = state.sharedIngredientIds.includes(conflict.ingredient_id);
        const dishes = conflict.recipe_ids.map(id => textOf(catalog.recipes.find(recipe => recipe.recipe_id === id)?.name)).join('、');
        return <Card key={conflict.ingredient_id} mode="outlined"><Card.Content style={styles.compact}>
          <Text>{nameOf(catalog, conflict.ingredient_id)}同时用于{dishes}</Text>
          <Button compact mode={shared ? 'text' : 'outlined'} onPress={() => update(previous => ({ ...previous,
            sharedIngredientIds: shared ? previous.sharedIngredientIds.filter(id => id !== conflict.ingredient_id)
              : [...new Set([...previous.sharedIngredientIds, conflict.ingredient_id])],
          }))}>{shared ? '已确认够用 · 撤销' : '够用'}</Button>
        </Card.Content></Card>;
      })}
      <Button mode="outlined" icon="plus" onPress={onBack}>继续选菜</Button>
    </ScrollView>
    {replacing && <ReplacementDialog catalog={catalog} state={state} evaluations={evaluations} candidates={candidates} recipeId={replacing}
      onDismiss={() => setReplacing(null)} onReplace={recipeId => { update(previous => replaceMealRecipe(previous, catalog, replacing, recipeId)); setReplacing(null); }} />}
    <Portal><Dialog visible={clearing} onDismiss={() => setClearing(false)}><Dialog.Title>清空这顿饭？</Dialog.Title>
      <Dialog.Actions><Button onPress={() => setClearing(false)}>保留</Button><Button onPress={() => { update(clearMeal); setClearing(false); onBack(); }}>清空</Button></Dialog.Actions>
    </Dialog></Portal>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, page: { padding: 20, paddingBottom: 36, gap: 16 }, compact: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 }, grow: { flex: 1 },
  dialog: { maxWidth: 520, width: '92%', maxHeight: '90%', alignSelf: 'center' },
  dialogScroll: { flexShrink: 1, maxHeight: 480 }, replacements: { paddingVertical: 16, gap: 12 },
});
