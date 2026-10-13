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
import { addIngredient } from './src/model/inventory-actions';
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
  const [tab, setTab] = useState(0);
  const [selectedDish, setSelectedDish] = useState<string | null>(null);
  const [filters, setFilters] = useState<AppFilters>({});
  const [confirmations, setConfirmations] = useState<readonly string[]>([]);
  const confirmationRef = useRef(confirmations);
  const [removed, setRemoved] = useState<readonly RemovedItem[]>([]);
  const [resetVisible, setResetVisible] = useState(false);
  const recommended = useMemo(() => kitchen.state && built.data
    ? built.data.recommend(engineInput(kitchen.state, filters, confirmations)) : null, [kitchen.state, filters, confirmations]);
  const evaluation = recommended?.data?.dishes.find(dish => dish.dish_id === selectedDish);

  const update = useCallback<UpdateKitchen>(transform => kitchen.update(previous => {
    const next = transform(previous);
    if (built.data && confirmationRef.current.length) {
      const preview = built.data.recommend(engineInput(next, {}));
      const active = new Set(preview.data?.dishes.flatMap(dish => dish.requirements.map(item => item.confirmation_key)) ?? []);
      confirmationRef.current = confirmationRef.current.filter(key => active.has(key));
      setConfirmations(confirmationRef.current);
    }
    return next;
  }), [kitchen.update]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedDish !== null) { setSelectedDish(null); return true; }
      if (tab !== 0) { setTab(0); return true; }
      return false;
    });
    return () => subscription.remove();
  }, [selectedDish, tab]);

  const openSettings = () => { setSelectedDish(null); setTab(2); };
  const confirmRule = (key: string) => {
    confirmationRef.current = [...new Set([...confirmationRef.current, key])];
    setConfirmations(confirmationRef.current);
  };
  const consume = (items: readonly RemovedItem[]) => {
    if (!items.length) { setSelectedDish(null); return; }
    update(previous => ({ ...previous,
      currentIds: previous.currentIds.filter(id => !items.some(item => item.location === 'current' && item.ingredientId === id)),
      pantryIds: previous.pantryIds.filter(id => !items.some(item => item.location === 'pantry' && item.ingredientId === id)),
    }));
    setRemoved(items);
    setSelectedDish(null);
  };
  const undo = () => {
    update(previous => removed.reduce((state, item) => addIngredient(state, catalog, item.ingredientId, item.location), previous));
    setRemoved([]);
  };
  const reset = () => {
    setSelectedDish(null); setTab(0); setRemoved([]); setFilters({});
    confirmationRef.current = []; setConfirmations([]); kitchen.reset();
  };

  return <PaperProvider theme={theme} settings={{ icon: props => <MaterialCommunityIcons {...props} /> }}>
    <StatusBar style={isDark ? 'light' : 'dark'} />
    <SafeAreaView style={[styles.outer, { backgroundColor: theme.colors.background }]} edges={['top', 'left', 'right']}>
      <View style={[styles.shell, { borderColor: theme.colors.outlineVariant }]}>
        <Banner visible={Boolean(kitchen.state && kitchen.error)} actions={[{ label: '重试保存', onPress: kitchen.retry }]} icon="content-save-alert-outline">
          {kitchen.error ?? ''}
        </Banner>
        {built.error ? <View style={styles.loading}><Text variant="titleLarge">菜谱数据暂时无法加载</Text><Text>{built.error.message}</Text></View>
          : !kitchen.state ? <View style={styles.loading}>
            {kitchen.error ? <><Text variant="titleLarge">本地记录暂时无法读取</Text><Text>{kitchen.error}</Text>
              <Button mode="contained" onPress={kitchen.retry}>重新读取</Button><Button onPress={() => setResetVisible(true)}>重置本机记录</Button></>
              : <ActivityIndicator />}
          </View> : <>
            <View style={[styles.screen, evaluation && styles.hidden]}>
              {tab === 0 ? <HomeScreen catalog={catalog} state={kitchen.state} update={update}
                  recommendations={recommended?.data ?? null} error={recommended?.error?.message ?? null} onOpenRecipe={setSelectedDish}
                  onOpenPantry={() => setTab(1)} onOpenSettings={openSettings} filters={filters} onFiltersChange={setFilters} />
                  : tab === 1 ? <PantryScreen catalog={catalog} state={kitchen.state} update={update} />
                    : <SettingsScreen catalog={catalog} state={kitchen.state} update={update} onReset={reset} />}
            </View>
            {evaluation && <RecipeScreen catalog={catalog} state={kitchen.state} evaluation={evaluation} update={update}
              onBack={() => setSelectedDish(null)} onConfirmRule={confirmRule} onConsumed={consume} />}
            {!evaluation && <BottomNavigation.Bar navigationState={{ index: tab, routes }} onTabPress={({ route }) => setTab(routes.findIndex(item => item.key === route.key))}
              renderIcon={({ route, color }) => <MaterialCommunityIcons name={route.focusedIcon as 'silverware-fork-knife'} size={24} color={color} />}
              style={{ backgroundColor: theme.colors.surface }} />}
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
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28, gap: 20 },
});
