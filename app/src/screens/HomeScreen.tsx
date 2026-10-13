import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Card, Chip, Divider, Text, useTheme } from 'react-native-paper';
import type { Course, Recommendations, Tier } from '../../../packages/engine/src/types';
import { IngredientPicker } from '../components/IngredientPicker';
import { RecipeCard } from '../components/RecipeCard';
import { addIngredient } from '../model/inventory-actions';
import type { AppCatalog, AppFilters, KitchenState, UpdateKitchen } from '../model/types';

type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  update: UpdateKitchen;
  recommendations: Recommendations | null;
  error: string | null;
  onOpenRecipe: (dishId: string) => void;
  onOpenPantry: () => void;
  onOpenSettings: () => void;
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

export function HomeScreen({ catalog, state, update, recommendations, error, onOpenRecipe, onOpenPantry, onOpenSettings, filters, onFiltersChange }: Props) {
  const theme = useTheme();
  const [pickerVisible, setPickerVisible] = useState(false);
  const [showInsufficient, setShowInsufficient] = useState(false);
  const names = new Map(catalog.ingredients.map((item) => [item.ingredient_id, item.names['zh-CN'] ?? item.ingredient_id]));
  const hasInventory = state.currentIds.length > 0 || state.pantryIds.length > 0;
  const filterStyle = (selected: boolean) => ({ backgroundColor: selected ? theme.colors.secondaryContainer : theme.colors.surfaceVariant });
  const dishes = recommendations?.dishes ?? [];
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
        <View style={styles.heading}>
          <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>FastCook</Text>
          <Text variant="headlineLarge" style={styles.title}>今天做什么</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>选好手头食材，看看能做哪些家常菜。</Text>
        </View>

        <Card mode="contained" style={{ backgroundColor: theme.colors.surface }}>
          <Card.Content style={styles.ingredientCard}>
            <View style={styles.sectionRow}>
              <Text variant="titleMedium" style={styles.bold}>当次食材</Text>
              <View style={styles.selectionActions}>
                <Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{state.currentIds.length} 种</Text>
                {state.currentIds.length > 0 && <Button compact onPress={() => update((previous) => ({ ...previous, currentIds: [] }))}>清空</Button>}
              </View>
            </View>
            {state.currentIds.length > 0 ? <View style={styles.chips}>{state.currentIds.map((id) => <Chip key={id} onClose={() => toggleCurrent(id)} closeIcon="close" accessibilityLabel={`${names.get(id) ?? id}，点击移除`} style={{ backgroundColor: theme.colors.secondaryContainer }}>{names.get(id) ?? id}</Chip>)}</View> : <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>冰箱里有什么？可以先选番茄、鸡蛋试试。</Text>}
            {state.currentIds.length > 0 && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>会保留这次选择，下次可直接修改。</Text>}
            <Button mode="contained" icon="plus" buttonColor={theme.colors.primaryContainer} textColor={theme.colors.onPrimaryContainer} contentStyle={styles.primaryButton} onPress={() => setPickerVisible(true)}>选择食材</Button>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>调料柜已记住 {state.pantryIds.length} 种，{state.pantryConfigured ? '会一起参与推荐。' : '确认后会一起参与推荐。'}</Text>
          </Card.Content>
        </Card>

        {!state.pantryConfigured && <Card mode="outlined" style={styles.setupCard}>
          <Card.Content style={styles.setupContent}>
            <Text variant="titleSmall">确认一次常备调料</Text>
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>勾选家里有的酱油、醋和葱姜蒜，以后自动记住。</Text>
            <Button mode="text" onPress={onOpenPantry} style={styles.leftButton}>设置调料柜</Button>
          </Card.Content>
        </Card>}
        {state.pantryConfigured && !state.equipmentConfigured && <Button mode="outlined" icon="pot-steam-outline" onPress={onOpenSettings}>确认厨具，让推荐更准确</Button>}

        {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{error}</Text>}
        {hasInventory ? <>
        <View style={styles.filters}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            <Chip selected={Object.keys(filters).length === 0} style={filterStyle(Object.keys(filters).length === 0)} showSelectedCheck={false} onPress={() => onFiltersChange({})}>全部</Chip>
            <Chip selected={filters.max_time_minutes === 20} style={filterStyle(filters.max_time_minutes === 20)} showSelectedCheck={false} onPress={() => setTime(20)}>20 分钟内</Chip>
            <Chip selected={filters.max_time_minutes === 30} style={filterStyle(filters.max_time_minutes === 30)} showSelectedCheck={false} onPress={() => setTime(30)}>30 分钟内</Chip>
            <Chip selected={filters.max_spicy_level === 0} style={filterStyle(filters.max_spicy_level === 0)} showSelectedCheck={false} onPress={toggleSpicy}>不辣</Chip>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {courses.map((course) => <Chip key={course.id} selected={filters.courses?.includes(course.id) ?? false} style={filterStyle(filters.courses?.includes(course.id) ?? false)} showSelectedCheck={false} onPress={() => toggleCourse(course.id)}>{course.name}</Chip>)}
          </ScrollView>
        </View>

        <View style={styles.resultsHeading}>
          <View style={styles.sectionRow}>
            <Text variant="titleLarge" style={styles.bold}>为你找到</Text>
            <Text variant="labelLarge" style={{ color: theme.colors.onSurfaceVariant }}>{feasibleCount} 道可做</Text>
          </View>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>按食材种类匹配，实际用量请看做法。</Text>
        </View>
        {!error && dishes.length === 0 && <Text style={{ color: theme.colors.onSurfaceVariant }}>没有符合筛选条件的菜，试试放宽时间或菜品类型。</Text>}
        {groups.map((group) => {
          const matches = dishes.filter((item) => item.tier === group.tier);
          if (matches.length === 0) return null;
          return <View key={group.tier} style={styles.group}>
            <View style={styles.groupTitle}><Text variant="titleSmall">{group.title}</Text><Text variant="labelMedium" style={{ color: theme.colors.onSurfaceVariant }}>{matches.length}</Text></View>
            {matches.map((evaluation) => <RecipeCard key={evaluation.dish_id} catalog={catalog} evaluation={evaluation} onPress={() => onOpenRecipe(evaluation.dish_id)} />)}
          </View>;
        })}

        {(recommendations?.purchases.length ?? 0) > 0 && <View style={styles.group}>
          <Text variant="titleMedium" style={styles.bold}>再买一种，多几道选择</Text>
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>补齐后新增可做的菜，买到后再加入食材。</Text>
          {recommendations?.purchases.slice(0, 3).map((purchase) => <Card key={purchase.ingredient_id} mode="contained" style={{ backgroundColor: theme.colors.secondaryContainer }}>
            <Card.Content style={styles.purchaseContent}>
              <View style={styles.sectionRow}><Text variant="titleSmall">{names.get(purchase.ingredient_id) ?? purchase.ingredient_id}</Text><Text variant="labelLarge">新增 {purchase.new_dish_count} 道</Text></View>
              <Text variant="bodySmall" style={{ color: theme.colors.onSecondaryContainer }}>{purchase.dish_ids.map((dishId) => catalog.recipes.find((recipe) => recipe.dish_id === dishId)?.name['zh-CN'] ?? dishId).join('、')}</Text>
            </Card.Content>
          </Card>)}
        </View>}

        {insufficient.length > 0 && <View style={styles.group}>
          <Divider />
          <Button mode="text" icon={showInsufficient ? 'chevron-up' : 'chevron-down'} onPress={() => setShowInsufficient(!showInsufficient)}>{showInsufficient ? '收起' : '查看'}其他 {insufficient.length} 道待备齐的菜</Button>
          {showInsufficient && insufficient.map((evaluation) => <RecipeCard key={evaluation.dish_id} catalog={catalog} evaluation={evaluation} onPress={() => onOpenRecipe(evaluation.dish_id)} />)}
        </View>}
        </> : <View style={styles.emptyState}>
          <Text variant="titleMedium" style={styles.bold}>从手头的一两样开始</Text>
          <Text variant="bodyMedium" style={{ color: theme.colors.onSurfaceVariant }}>选择食材后，这里会显示能做的菜和需要补齐的原料。</Text>
        </View>}
        {catalog.recipes.some(recipe => recipe.review_state !== 'reviewed') && <Text variant="bodySmall" style={[styles.draftNotice, { color: theme.colors.onSurfaceVariant }]}>收录菜谱含待审核内容，来源可在详情查看。</Text>}
      </ScrollView>
      <IngredientPicker visible={pickerVisible} title="选择当次食材" location="current" ingredients={catalog.ingredients} selectedIds={state.currentIds} otherSelectedIds={state.pantryIds} onToggle={toggleCurrent} onDismiss={() => setPickerVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 36, gap: 24 },
  heading: { gap: 8, paddingTop: 12 },
  title: { fontWeight: '700', letterSpacing: -0.6 },
  bold: { fontWeight: '700' },
  ingredientCard: { gap: 16, paddingVertical: 20 },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryButton: { minHeight: 48 },
  setupCard: { borderRadius: 18 },
  setupContent: { gap: 8, paddingTop: 16, paddingBottom: 8 },
  leftButton: { alignSelf: 'flex-start', marginLeft: -8 },
  filters: { gap: 10 },
  filterRow: { gap: 8 },
  resultsHeading: { gap: 8 },
  emptyState: { gap: 10, paddingVertical: 8 },
  group: { gap: 12 },
  groupTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  purchaseContent: { gap: 8, paddingVertical: 16 },
  draftNotice: { textAlign: 'center', lineHeight: 20 },
});
