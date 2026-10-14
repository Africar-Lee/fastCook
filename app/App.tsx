import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View, useColorScheme } from 'react-native';
import { ActivityIndicator, Banner, BottomNavigation, Button, Dialog, PaperProvider, Portal, Snackbar, Text } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFonts } from 'expo-font';
import { createEngine } from '../packages/engine/src/index';
import type { EngineInput, Equipment } from '../packages/engine/src/types';
import data from './src/data/catalog.json';
import { HomeScreen } from './src/screens/HomeScreen';
import { PantryScreen } from './src/screens/PantryScreen';
import { RecipeScreen } from './src/screens/RecipeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { MealScreen } from './src/screens/MealScreen';
import { MealPlansDialog } from './src/components/MealPlansDialog';
import { addIngredient } from './src/model/inventory-actions';
import { addMealRecipe, adoptMeal } from './src/model/meal-actions';
import { isNewKitchen } from './src/model/pantry-setup';
import { equipmentLabels } from './src/model/presentation';
import type { AppCatalog, AppFilters, KitchenState, UpdateKitchen } from './src/model/types';
import { useKitchen } from './src/model/useKitchen';
import { darkTheme, lightTheme } from './src/theme';

const catalog = data as AppCatalog;
const built = createEngine(catalog, { allowDraft: true });
const routes = [
  { key: 'today', title: '今天做什么', focusedIcon: 'silverware-fork-knife' },
  { key: 'pantry', title: '调料柜', focusedIcon: 'cupboard-outline' },
  { key: 'settings', title: '设置', focusedIcon: 'tune-variant' },
];
type RemovedItem = Readonly<{ ingredientId: string; location: 'current' | 'pantry' }>;

function engineInput(state: KitchenState, filters: AppFilters, confirmations: readonly string[] = []): EngineInput {
  return {
    inventory: {
      items: [...state.currentIds.map(id => ({ item_id: `current_${id}`, ingredient_id: id, location: 'current' as const })),
        ...state.pantryIds.map(id => ({ item_id: `pantry_${id}`, ingredient_id: id, location: 'pantry' as const }))],
      unavailable_ingredient_ids: state.unavailableIds,
      ...(state.equipmentConfigured ? { equipment: { available: state.equipment,
        unavailable: (Object.keys(equipmentLabels) as Equipment[]).filter(id => !state.equipment.includes(id)) } } : {}),
    }, filters, confirmations,
  };
}

function KitchenApp() {
  const kitchen = useKitchen(catalog);
  const isDark = useColorScheme() === 'dark';
  const theme = isDark ? darkTheme : lightTheme;
  const [tab, setTab] = useState<number | null>(null);
  const initialSetup = useRef(false);
  const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);
  const [mealVisible, setMealVisible] = useState(false);
  const [plansVisible, setPlansVisible] = useState(false);
  const [filters, setFilters] = useState<AppFilters>({});
  const [confirmations, setConfirmations] = useState<readonly string[]>([]);
  const confirmationRef = useRef(confirmations);
  const [removed, setRemoved] = useState<readonly RemovedItem[]>([]);
  const [resetVisible, setResetVisible] = useState(false);
  const recommended = useMemo(() => kitchen.state && built.data
    ? built.data.recommend(engineInput(kitchen.state, filters, confirmations)) : null, [kitchen.state, filters, confirmations]);
  const allRecommended = useMemo(() => kitchen.state && built.data
    ? built.data.recommend(engineInput(kitchen.state, {}, confirmations)) : null, [kitchen.state, confirmations]);
  const evaluation = useMemo(() => kitchen.state && selectedRecipe && built.data
    ? allRecommended?.data?.dishes.find(item => item.recipe_id === selectedRecipe)
      ?? built.data.evaluateRecipe(selectedRecipe, engineInput(kitchen.state, {}, confirmations)).data : null,
  [kitchen.state, selectedRecipe, confirmations, allRecommended]);
  const mealEvaluations = useMemo(() => kitchen.state?.mealRecipeIds.flatMap(recipeId => {
    const recommended = allRecommended?.data?.dishes.find(item => item.recipe_id === recipeId);
    if (recommended) return [recommended];
    const result = built.data?.evaluateRecipe(recipeId, engineInput(kitchen.state!, {}, confirmations));
    return result?.data ? [result.data] : [];
  }) ?? [], [kitchen.state, confirmations, allRecommended]);
  const mealCandidates = useMemo(() => (allRecommended?.data?.dishes ?? []).filter(item => {
    const recipe = catalog.recipes.find(recipe => recipe.recipe_id === item.recipe_id)!;
    return (filters.max_time_minutes === undefined || recipe.time_minutes <= filters.max_time_minutes)
      && (filters.max_spicy_level === undefined || recipe.spicy_level <= filters.max_spicy_level);
  }), [allRecommended, filters.max_time_minutes, filters.max_spicy_level]);

  const update = useCallback<UpdateKitchen>(transform => kitchen.update(previous => {
    let next = transform(previous);
    const inventoryFields = ['currentIds', 'pantryIds', 'unavailableIds'] as const;
    if (inventoryFields.some(key => previous[key].join('|') !== next[key].join('|'))) next = { ...next, sharedIngredientIds: [] };
    if (built.data && confirmationRef.current.length) {
      const preview = built.data.recommend(engineInput(next, {}));
      const active = new Set(preview.data?.dishes.flatMap(dish => dish.requirements.map(item => item.confirmation_key)) ?? []);
      confirmationRef.current = confirmationRef.current.filter(key => active.has(key));
      setConfirmations(confirmationRef.current);
    }
    return next;
  }), [kitchen.update]);

  useEffect(() => {
    if (!kitchen.state || tab !== null) return;
    initialSetup.current = isNewKitchen(kitchen.state);
    setTab(initialSetup.current ? 1 : 0);
  }, [kitchen.state, tab]);

  const selectTab = useCallback((next: number) => {
    if (initialSetup.current && next !== 1) {
      initialSetup.current = false;
      kitchen.update(previous => previous);
    }
    setTab(next);
  }, [kitchen.update]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedRecipe !== null) { setSelectedRecipe(null); return true; }
      if (mealVisible) { setMealVisible(false); return true; }
      if (tab !== null && tab !== 0) { selectTab(0); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [selectedRecipe, mealVisible, tab, selectTab]);

  const openSettings = () => { setSelectedRecipe(null); setMealVisible(false); selectTab(2); };
  const finishSetup = () => { initialSetup.current = false; setTab(0); };
  const skipSetup = () => { update(previous => previous); finishSetup(); };
  const confirmRule = (key: string) => {
    confirmationRef.current = [...new Set([...confirmationRef.current, key])];
    setConfirmations(confirmationRef.current);
  };
  const consume = (items: readonly RemovedItem[]) => {
    if (!items.length) { setSelectedRecipe(null); return; }
    update(previous => ({ ...previous,
      currentIds: previous.currentIds.filter(id => !items.some(item => item.location === 'current' && item.ingredientId === id)),
      pantryIds: previous.pantryIds.filter(id => !items.some(item => item.location === 'pantry' && item.ingredientId === id)),
    }));
    setRemoved(items);
    setSelectedRecipe(null);
  };
  const undo = () => {
    update(previous => removed.reduce((state, item) => addIngredient(state, catalog, item.ingredientId, item.location), previous));
    setRemoved([]);
  };
  const reset = () => {
    initialSetup.current = false;
    setSelectedRecipe(null); setMealVisible(false); setPlansVisible(false); setTab(0); setRemoved([]); setFilters({});
    confirmationRef.current = []; setConfirmations([]); kitchen.reset();
  };
  const restore = async (state: KitchenState) => {
    const result = await kitchen.restore(state);
    if (result.error === null) {
      initialSetup.current = false;
      setSelectedRecipe(null); setMealVisible(false); setPlansVisible(false); setRemoved([]); setFilters({});
      confirmationRef.current = []; setConfirmations([]);
    }
    return result;
  };

  return <PaperProvider theme={theme} settings={{ icon: props => <MaterialCommunityIcons {...props} /> }}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <SafeAreaView style={[styles.outer, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.shell, { borderColor: theme.colors.outlineVariant }]}>
        <Banner visible={Boolean(kitchen.state && kitchen.error)} actions={[{ label: '重试保存', onPress: kitchen.retry }]} icon="content-save-alert-outline">
          {kitchen.error ?? ''}
        </Banner>
        {built.error ? <View style={styles.loading}><Text variant="titleLarge">菜谱数据暂时无法加载</Text><Text>{built.error.message}</Text></View>
          : !kitchen.state || tab === null ? <View style={styles.loading}>
            {kitchen.error ? <><Text variant="titleLarge">本地记录暂时无法读取</Text><Text>{kitchen.error}</Text>
              <Button mode="contained" onPress={kitchen.retry}>重新读取</Button><Button onPress={() => setResetVisible(true)}>重置本机记录</Button></>
              : <ActivityIndicator />}
          </View> : <>
            <View style={[styles.screen, (evaluation || mealVisible) && styles.hidden]}>
              {tab === 0 ? <HomeScreen catalog={catalog} state={kitchen.state} update={update}
                  recommendations={recommended?.data ?? null} error={recommended?.error?.message ?? null} onOpenRecipe={setSelectedRecipe}
                  mealEvaluations={mealEvaluations} onAutoPlan={() => setPlansVisible(true)}
                  onOpenPantry={() => selectTab(1)} onOpenSettings={openSettings} filters={filters} onFiltersChange={setFilters} />
                  : tab === 1 ? <PantryScreen catalog={catalog} state={kitchen.state} update={update}
                    onSetupComplete={finishSetup} onSkipSetup={skipSetup} />
                    : <SettingsScreen catalog={catalog} state={kitchen.state} update={update} onReset={reset} onRestore={restore} disabled={kitchen.saving} />}
            </View>
            {mealVisible && <View style={[styles.screen, evaluation && styles.hidden]}>
              <MealScreen catalog={catalog} state={kitchen.state} update={update} evaluations={mealEvaluations} candidates={mealCandidates}
                onBack={() => setMealVisible(false)} onOpenRecipe={setSelectedRecipe} onAutoPlan={() => setPlansVisible(true)} />
            </View>}
            {evaluation && <RecipeScreen catalog={catalog} state={kitchen.state} evaluation={evaluation} update={update}
              onBack={() => setSelectedRecipe(null)} onConfirmRule={confirmRule} onConsumed={consume}
              onAddMeal={() => update(previous => addMealRecipe(previous, catalog, evaluation.recipe_id))}
              inMeal={catalog.recipes.some(recipe => kitchen.state!.mealRecipeIds.includes(recipe.recipe_id) && recipe.dish_id === evaluation.dish_id)}
              mealFull={kitchen.state.mealRecipeIds.length >= 5} />}
            {!evaluation && !mealVisible && tab === 0 && kitchen.state.mealRecipeIds.length > 0 &&
              <Button mode="contained-tonal" icon="silverware-fork-knife" style={styles.mealBar} contentStyle={styles.mealBarContent}
                onPress={() => setMealVisible(true)}>这顿 {kitchen.state.mealRecipeIds.length} 道 · {kitchen.state.mealPeople} 人 · 查看</Button>}
            {!evaluation && !mealVisible && <BottomNavigation.Bar navigationState={{ index: tab, routes }} onTabPress={({ route }) => selectTab(routes.findIndex(item => item.key === route.key))}
              renderIcon={({ route, color }) => <MaterialCommunityIcons name={route.focusedIcon as 'silverware-fork-knife'} size={24} color={color} />}
              style={{ backgroundColor: theme.colors.surface }} />}
            {plansVisible && <MealPlansDialog catalog={catalog} state={kitchen.state} candidates={mealCandidates}
              onDismiss={() => setPlansVisible(false)} onAdopt={(ids, people) => {
                update(previous => adoptMeal(previous, catalog, ids, people)); setPlansVisible(false); setMealVisible(true);
              }} />}
          </>}
        <Snackbar visible={removed.length > 0} onDismiss={() => setRemoved([])} duration={10000} action={{ label: '撤销', onPress: undo }}>
          {`已移除 ${removed.length} 种食材`}
        </Snackbar>
      </View>
    </SafeAreaView>
    <Portal><Dialog visible={resetVisible} onDismiss={() => setResetVisible(false)}>
      <Dialog.Title>重置本机记录？</Dialog.Title><Dialog.Content><Text>已保存的食材、调料柜和厨具设置会被清除。</Text></Dialog.Content>
      <Dialog.Actions><Button onPress={() => setResetVisible(false)}>保留</Button><Button onPress={() => { setResetVisible(false); reset(); }}>确认重置</Button></Dialog.Actions>
    </Dialog></Portal>
  </PaperProvider>;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(MaterialCommunityIcons.font);
  if (!fontsLoaded && !fontError) return <View style={styles.loading}><ActivityIndicator /></View>;
  return <SafeAreaProvider><KitchenApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  outer: { flex: 1 }, shell: { flex: 1, width: '100%', maxWidth: 600, alignSelf: 'center', borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth },
  screen: { flex: 1 }, hidden: { display: 'none' },
  mealBar: { marginHorizontal: 16, marginVertical: 8 }, mealBarContent: { minHeight: 48 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 20 },
});
