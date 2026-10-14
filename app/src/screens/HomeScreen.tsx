import { formatList, t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, Text, useTheme } from 'react-native-paper';
import type { Course, Recommendations, Tier } from '../../../packages/engine/src/types';
import { rankMealCandidates } from '../../../packages/engine/src/meal';
import type { RecipeEvaluation } from '../../../packages/engine/src/types';
import { IngredientPicker } from '../components/IngredientPicker';
import { RecipeCard } from '../components/RecipeCard';
import { ingredientName } from '../model/presentation';
import { addIngredient } from '../model/inventory-actions';
import { addMealRecipe } from '../model/meal-actions';
import type { AppCatalog, AppFilters, KitchenState, UpdateKitchen } from '../model/types';

type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  update: UpdateKitchen;
  recommendations: Recommendations | null;
  error: string | null;
  onOpenRecipe: (recipeId: string) => void;
  mealEvaluations: readonly RecipeEvaluation[];
  onAutoPlan: () => void;
  onOpenPantry: () => void;
  onOpenSettings: () => void;
  onRecognize: () => void;
  filters: AppFilters;
  onFiltersChange: (filters: AppFilters) => void;
}>;

const groups: readonly Readonly<{ tier: Tier; title: string }>[] = [
  { tier: 'ready', title: '原料齐全' },
  { tier: 'caveat', title: '可做有提示' },
  { tier: 'needs_confirmation', title: '需确认' },
  { tier: 'one_missing', title: '再备一样' },
];
const courses: readonly Readonly<{ id: Course; name: string }>[] = [
  { id: 'meat', name: '荤菜' }, { id: 'veg', name: '素菜' }, { id: 'soup', name: '汤羹' }, { id: 'staple', name: '主食' }, { id: 'cold', name: '凉菜' },
];

export function HomeScreen({ catalog, state, update, recommendations, error, onOpenRecipe, onOpenPantry, onOpenSettings, onRecognize, filters, onFiltersChange, mealEvaluations, onAutoPlan }: Props) {
  useI18n();
  const theme = useTheme();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, ingredientName(item)]));
  const hasInventory = state.currentIds.length > 0 || state.pantryIds.length > 0;
  const filterStyle = (selected: boolean) => ({ backgroundColor: selected ? theme.colors.secondaryContainer : theme.colors.surfaceVariant });
  const dishes = state.mealRecipeIds.length ? rankMealCandidates(catalog, recommendations?.dishes ?? [], mealEvaluations,
    { people: state.mealPeople, sharedIngredientIds: state.sharedIngredientIds }) : recommendations?.dishes ?? [];
  const selectedDishes = new Set(catalog.recipes.filter(recipe => state.mealRecipeIds.includes(recipe.recipe_id)).map(recipe => recipe.dish_id));
  const card = (evaluation: RecipeEvaluation) => <RecipeCard key={evaluation.dish_id} catalog={catalog} evaluation={evaluation}
    onPress={() => onOpenRecipe(evaluation.recipe_id)} selected={selectedDishes.has(evaluation.dish_id)} addDisabled={state.mealRecipeIds.length >= 5}
    onAdd={() => update(previous => addMealRecipe(previous, catalog, evaluation.recipe_id))} />;
  const feasibleCount = dishes.filter((item) => item.tier === 'ready' || item.tier === 'caveat').length;
  const insufficient = dishes.filter((item) => item.tier === 'insufficient');
  const toggleCurrent = (id: string) => update((previous) => {
    if (previous.currentIds.includes(id)) return { ...previous, currentIds: previous.currentIds.filter((value) => value !== id) };
    return addIngredient(previous, catalog, id, 'current');
  });
  const setTime = (minutes: number | null) => {
    const { max_time_minutes: previousTime, ...remaining } = filters;
    onFiltersChange(minutes === null || previousTime === minutes ? remaining : { ...remaining, max_time_minutes: minutes });
  };
  const toggleSpicy = () => {
    const { max_spicy_level, ...remaining } = filters;
    onFiltersChange(max_spicy_level === 0 ? remaining : { ...remaining, max_spicy_level: 0 });
  };
  const toggleCourse = (course: Course) => {
    const { courses: previousCourses, ...remaining } = filters;
    onFiltersChange(previousCourses?.includes(course) ? remaining : { ...remaining, courses: [course] });
  };

  return (
    <>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <Text variant="headlineLarge" style={styles.title}>{t('今天做什么')}</Text>

        <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
          <Card.Content style={styles.ingredientCard}>
            <View style={styles.sectionRow}>
              <Text variant="titleMedium" style={styles.bold}>{t('当次食材')}</Text>
              <View style={styles.selectionActions}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{t('{count} 种', { count: state.currentIds.length })}</Text>
                {state.currentIds.length > 0 && <Button compact onPress={() => update((previous) => ({ ...previous, currentIds: [] }))}>{t('清空')}</Button>}
              </View>
            </View>
            {state.currentIds.length > 0 && <View style={styles.chips}>{state.currentIds.map((id) => <Chip key={id} onClose={() => toggleCurrent(id)} closeIcon="close"
              accessibilityLabel={t('{name}，点击移除', { name: names.get(id) ?? id })} closeIconAccessibilityLabel={t('移除{ingredient}', { ingredient: names.get(id) ?? id })}
              style={{ backgroundColor: theme.colors.secondaryContainer }}>{names.get(id) ?? id}</Chip>)}</View>}
            <Button mode="contained" icon="plus" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer} contentStyle={styles.primaryButton} onPress={() => setPickerVisible(true)}>{t('选择食材')}</Button>
            <Button mode="outlined" icon="camera-outline" onPress={onRecognize}>{t('拍照识别')}</Button>
            <Button compact mode="text" onPress={onOpenPantry} style={styles.pantryButton}>{state.pantryConfigured ? t('调料柜 · {count} 种', { count: state.pantryIds.length }) : t('设置调料柜')}</Button>
          </Card.Content>
        </Card>

        {state.pantryConfigured && !state.equipmentConfigured && <Button mode="outlined" icon="pot-steam-outline" onPress={onOpenSettings}>{t('设置厨具')}</Button>}

        {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
        {hasInventory ? <>
        <View style={styles.filters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Chip selected={Object.keys(filters).length === 0} style={filterStyle(Object.keys(filters).length === 0)} showSelectedCheck={false} onPress={() => onFiltersChange({})}>{t('全部')}</Chip>
            <Chip selected={filters.max_time_minutes === 20} style={filterStyle(filters.max_time_minutes === 20)} showSelectedCheck={false} onPress={() => setTime(20)}>{t('20 分钟内')}</Chip>
            <Chip selected={filters.max_time_minutes === 30} style={filterStyle(filters.max_time_minutes === 30)} showSelectedCheck={false} onPress={() => setTime(30)}>{t('30 分钟内')}</Chip>
            <Chip selected={filters.max_spicy_level === 0} style={filterStyle(filters.max_spicy_level === 0)} showSelectedCheck={false} onPress={toggleSpicy}>{t('不辣')}</Chip>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {courses.map((course) => <Chip key={course.id} selected={filters.courses?.includes(course.id) ?? false} style={filterStyle(filters.courses?.includes(course.id) ?? false)} showSelectedCheck={false} onPress={() => toggleCourse(course.id)}>{t(course.name)}</Chip>)}
          </ScrollView>
        </View>

        <View style={styles.sectionRow}>
          <Text variant="titleLarge" style={styles.bold}>{t('推荐菜谱')}</Text>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>{t('{count} 道可做', { count: feasibleCount })}</Text>
        </View>
        <Button mode="contained-tonal" icon="silverware-fork-knife" onPress={onAutoPlan}>{t('帮我配一顿')}</Button>
        {!error && dishes.length === 0 && <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('暂无符合筛选条件的菜谱')}</Text>}
        {groups.map((group) => {
          const matches = dishes.filter((item) => item.tier === group.tier);
          if (matches.length === 0) return null;
          return <View key={group.tier} style={styles.group}>
            <View style={styles.groupTitle}><Text variant="titleSmall">{t(group.title)}</Text><Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{matches.length}</Text></View>
            {matches.map(card)}
          </View>;
        })}

        {(recommendations?.purchases.length ?? 0) > 0 && <View style={styles.group}>
          <Text variant="titleMedium" style={styles.bold}>{t('再买一样')}</Text>
          {recommendations?.purchases.slice(0, 3).map((purchase) => <Card key={purchase.ingredient_id} mode="contained" style={{ backgroundColor: theme.colors.secondaryContainer }}>
            <Card.Content style={styles.purchaseContent}>
              <View style={styles.sectionRow}><Text variant="titleSmall">{names.get(purchase.ingredient_id) ?? purchase.ingredient_id}</Text><Text variant="labelLarge">{t('新增 {count} 道', { count: purchase.new_dish_count })}</Text></View>
              <Text variant="bodySmall" style={{ color: theme.colors.onSecondaryContainer }}>{formatList(purchase.dish_ids.map((dishId) => catalog.recipes.find((recipe) => recipe.dish_id === dishId)?.name['zh-CN'] ?? dishId))}</Text>
            </Card.Content>
          </Card>)}
        </View>}

        {insufficient.length > 0 && <View style={styles.group}>
          <Divider />
          <Button mode="text" icon={showInsufficient ? 'chevron-up' : 'chevron-down'} onPress={() => setShowInsufficient(!showInsufficient)}>{t(showInsufficient ? '收起其他 {count} 道' : '查看其他 {count} 道', { count: insufficient.length })}</Button>
          {showInsufficient && insufficient.map(card)}
        </View>}
        </> : <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('选择食材，查看推荐菜谱')}</Text>}
      </ScrollView>
      <IngredientPicker visible={pickerVisible} title={t('选择当次食材')} location="current" ingredients={catalog.ingredients} selectedIds={state.currentIds} otherSelectedIds={state.pantryIds} onToggle={toggleCurrent} onDismiss={() => setPickerVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 36, gap: 20 },
  title: { fontWeight: '700', letterSpacing: -0.6, paddingTop: 8 },
  bold: { fontWeight: '700' },
  ingredientCard: { gap: 12, paddingVertical: 16 },
  sectionRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { minHeight: 48 },
  pantryButton: { alignSelf: 'center' },
  filters: { gap: 10 },
  filterRow: { gap: 8 },
  group: { gap: 12 },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  purchaseContent: { gap: 8, paddingVertical: 16 },
});
