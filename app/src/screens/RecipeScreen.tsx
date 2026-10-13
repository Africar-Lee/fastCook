import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Checkbox, Dialog, Divider, Portal, Surface, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExecutionStep, RecipeEvaluation, Requirement, RequirementMatch, Step } from '../../../packages/engine/src/types';
import { addIngredient, markUnavailable } from '../model/inventory-actions';
import { equipmentLabels, formatQuantity, importanceLabels, nameOf, textOf, tierLabels } from '../model/presentation';
import { safeSourceUrl, sourceLinks } from '../model/source-presentation';
import type { AppCatalog, AppRecipe, AppRequirement, AppSource, KitchenState, UpdateKitchen } from '../model/types';

type ConsumedItem = Readonly<{ ingredientId: string; location: 'current' | 'pantry' }>;
type Props = Readonly<{
  catalog: AppCatalog;
  state: KitchenState;
  evaluation: RecipeEvaluation;
  update: UpdateKitchen;
  onBack: () => void;
  onConfirmRule: (key: string) => void;
  onConsumed: (removed: readonly ConsumedItem[]) => void;
  onOpenSettings: () => void;
}>;

function matchLabel(match: RequirementMatch): string {
  if (match.omitted) return '已省略';
  if (match.presence === 'uncertain') return '需确认';
  if (match.presence === 'missing') return '缺少';
  if (match.match_kind === 'substitution') return '使用替代';
  if (match.match_kind === 'implicit') return '常备默认';
  return '已有';
}

function locationFor(requirement: Requirement, match?: RequirementMatch): 'current' | 'pantry' {
  if (match?.inventory_item_id?.startsWith('current_')) return 'current';
  if (match?.inventory_item_id?.startsWith('pantry_')) return 'pantry';
  return requirement.role === 'seasoning' || requirement.role === 'garnish' ? 'pantry' : 'current';
}

function uncertainIdentity(match: RequirementMatch): string | undefined {
  if (match.match_kind === 'generic') return match.ingredient_id;
  if (match.reason_code !== 'substitute_requires_identity_confirmation') return undefined;
  const target = match.reason_params.substitute_ingredient_id;
  return typeof target === 'string' ? target : undefined;
}

function matchExplanation(catalog: AppCatalog, match: RequirementMatch): string {
  if (match.match_kind === 'implicit') return '按常备油盐水计算，缺少时请点“我没有”。';
  if (match.presence !== 'uncertain') return '';
  const identity = uncertainIdentity(match);
  if (identity && match.used_ingredient_id) {
    return `已选${nameOf(catalog, match.used_ingredient_id)}，请确认是否为${nameOf(catalog, identity)}。`;
  }
  if (match.reason_code === 'substitution_condition_uncertain') return '使用这项替代前，请确认下方所需原料。';
  return '请阅读下方替代说明，确认用量与处理方法。';
}

function RequirementActions({ catalog, requirement, match, update, onConfirmRule }: Readonly<{
  catalog: AppCatalog; requirement: Requirement; match: RequirementMatch; update: UpdateKitchen; onConfirmRule: Props['onConfirmRule'];
}>) {
  const identity = uncertainIdentity(match);
  const add = (ingredientId: string, replacement?: string) => update(previous => {
    const location = locationFor(requirement, match);
    const key = location === 'current' ? 'currentIds' : 'pantryIds';
    const prepared = replacement ? { ...previous, [key]: previous[key].filter(id => id !== replacement) } : previous;
    return addIngredient(prepared, catalog, ingredientId, location);
  });
  const remove = () => {
    const ingredientId = match.used_ingredient_id ?? match.ingredient_id;
    update(previous => markUnavailable(previous, catalog, ingredientId));
  };
  const conditions = match.reason_code === 'substitution_condition_uncertain'
    ? match.reason_params.condition_ingredient_ids : undefined;
  return <View style={styles.actions}>
    {identity && <Button compact mode="outlined" onPress={() => add(identity, match.used_ingredient_id)}>
      确认是{nameOf(catalog, identity)}
    </Button>}
    {match.presence === 'missing' && <Button compact mode="outlined" onPress={() => add(requirement.ingredient_id)}>
      我有{nameOf(catalog, requirement.ingredient_id)}
    </Button>}
    {Array.isArray(conditions) && conditions.map(id => <Button key={id} compact mode="outlined" onPress={() => add(id)}>
      确认有{nameOf(catalog, id)}
    </Button>)}
    {match.confirmation_key && <Button compact mode="outlined" onPress={() => onConfirmRule(match.confirmation_key!)}>
      确认按说明替代
    </Button>}
    {!match.omitted && match.presence === 'present' && <Button compact onPress={remove}>我没有</Button>}
  </View>;
}

function RequirementRow({ catalog, requirement, match, update, onConfirmRule }: Readonly<{
  catalog: AppCatalog; requirement: AppRequirement; match: RequirementMatch; update: UpdateKitchen; onConfirmRule: Props['onConfirmRule'];
}>) {
  const theme = useTheme();
  const substitution = match.match_kind === 'substitution' && !match.omitted;
  const used = match.used_ingredient_id;
  const explanation = matchExplanation(catalog, match);
  const color = match.presence === 'missing' && !match.omitted ? theme.colors.error : theme.colors.onSurfaceVariant;
  return <View style={styles.requirement}>
    <View style={styles.row}>
      <Text variant="titleMedium" style={styles.grow}>{nameOf(catalog, requirement.ingredient_id)}</Text>
      <Text variant="labelMedium" style={{ color }}>{matchLabel(match)}</Text>
    </View>
    <Text style={{ color: theme.colors.onSurfaceVariant }}>
      {formatQuantity(requirement.quantity)} · {importanceLabels[requirement.importance]}
    </Text>
    {requirement.preparation && <Text style={{ color: theme.colors.onSurfaceVariant }}>{textOf(requirement.preparation)}</Text>}
    {substitution && used && <Text style={{ color: theme.colors.primary }}>
      改用{nameOf(catalog, used)}，{match.quantity ? `整菜用量 ${formatQuantity(match.quantity)}` : '用量见下方替代说明'}
    </Text>}
    {match.match_kind === 'approved_descendant' && used && <Text>使用已选的{nameOf(catalog, used)}</Text>}
    {explanation.length > 0 && <Text>{explanation}</Text>}
    {match.note && <Text style={styles.note}>{textOf(match.note)}</Text>}
    <RequirementActions catalog={catalog} requirement={requirement} match={match} update={update} onConfirmRule={onConfirmRule} />
  </View>;
}

function RecipeStatus({ catalog, evaluation, onOpenSettings }: Pick<Props, 'catalog' | 'evaluation' | 'onOpenSettings'>) {
  const theme = useTheme();
  return <Surface elevation={0} style={[styles.status, { backgroundColor: theme.colors.secondaryContainer }]}>
    <Text variant="titleMedium">{tierLabels[evaluation.tier]}</Text>
    <Text>按已选原料种类匹配，用量请在下厨前核对。</Text>
    {evaluation.missing_required_ingredient_ids.length > 0 && <Text>
      还缺{evaluation.missing_required_ingredient_ids.map(id => nameOf(catalog, id)).join('、')}。
    </Text>}
    {evaluation.missing_equipment.length > 0 && <Text>
      缺少{evaluation.missing_equipment.map(id => equipmentLabels[id]).join('、')}。
    </Text>}
    {evaluation.uncertain_equipment.length > 0 && <Text>
      请确认家里有{evaluation.uncertain_equipment.map(id => equipmentLabels[id]).join('、')}。
    </Text>}
    {(evaluation.missing_equipment.length > 0 || evaluation.uncertain_equipment.length > 0) &&
      <Button mode="outlined" onPress={onOpenSettings} style={styles.selfStart}>设置厨具</Button>}
    {!evaluation.plan_valid && <Text>用料调整存在冲突，请补齐原料后重新匹配。</Text>}
  </Surface>;
}

function StepRow({ catalog, step, index }: Readonly<{ catalog: AppCatalog; step: Step | ExecutionStep; index: number }>) {
  const theme = useTheme();
  const substitutions = 'substitutions' in step ? step.substitutions : [];
  return <View style={styles.step}>
    <Text variant="labelLarge" style={[styles.stepNumber, { color: theme.colors.primary }]}>{String(index + 1).padStart(2, '0')}</Text>
    <View style={styles.grow}>
      {substitutions.map(substitution => <Surface key={substitution.requirement_id} elevation={0}
        style={[styles.substitution, { backgroundColor: theme.colors.tertiaryContainer }]}>
        <Text variant="labelLarge">此步使用{nameOf(catalog, substitution.used_ingredient_id)}</Text>
        <Text>{textOf(substitution.usage_note)}</Text>
        <Text>原文中的{nameOf(catalog, substitution.original_ingredient_id)}按此替代说明处理。</Text>
        {substitution.recipe_quantity && <Text variant="bodySmall">
          整菜参考用量 {formatQuantity(substitution.recipe_quantity)}，按步骤分配。
        </Text>}
      </Surface>)}
      <Text variant="bodyLarge" style={styles.stepText}>{textOf(step.text)}</Text>
    </View>
  </View>;
}

function consumedItems(state: KitchenState, evaluation: RecipeEvaluation): readonly ConsumedItem[] {
  const used = new Set(evaluation.used_inventory_item_ids);
  return [
    ...state.currentIds.filter(id => used.has(`current_${id}`)).map(ingredientId => ({ ingredientId, location: 'current' as const })),
    ...state.pantryIds.filter(id => used.has(`pantry_${id}`)).map(ingredientId => ({ ingredientId, location: 'pantry' as const })),
  ];
}

function ConsumedDialog({ catalog, items, onDismiss, onConfirm }: Readonly<{
  catalog: AppCatalog; items: readonly ConsumedItem[]; onDismiss: () => void; onConfirm: Props['onConsumed'];
}>) {
  const [selected, setSelected] = useState(() => new Set(items.map(item => `${item.location}_${item.ingredientId}`)));
  const toggle = (key: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>哪些食材已经用完？</Dialog.Title>
    <Dialog.Content><Text>勾选用完的食材，将它们从清单移除。还有剩余的可以保留。</Text></Dialog.Content>
    <Dialog.ScrollArea style={styles.dialogScroll}><ScrollView>
      {items.map(item => {
        const key = `${item.location}_${item.ingredientId}`;
        return <Checkbox.Item key={key} label={`${nameOf(catalog, item.ingredientId)} · ${item.location === 'current' ? '本次食材' : '调料柜'}`}
          status={selected.has(key) ? 'checked' : 'unchecked'} onPress={() => toggle(key)} />;
      })}
      {items.length === 0 && <Text style={styles.empty}>这道菜没有需要移除的食材。</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>取消</Button><Button onPress={() => {
      onDismiss();
      onConfirm(items.filter(item => selected.has(`${item.location}_${item.ingredientId}`)));
    }}>确认</Button></Dialog.Actions>
  </Dialog></Portal>;
}

function RecipeSource({ source }: Readonly<{ source: AppSource }>) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const links = sourceLinks(source);
  const open = async (value: string, label: string) => {
    const url = safeSourceUrl(value);
    if (!url) {
      setError(`${label}地址不可用，请检查菜谱来源。`);
      return;
    }
    setError(null);
    const result = await Linking.openURL(url).then(
      () => ({ error: null }),
      () => ({ error: `无法打开${label}，请检查浏览器是否可用后重试。` }),
    );
    setError(result.error);
  };
  return <View style={styles.source}>
    <Text variant="titleSmall">{source.provenance.origin}</Text>
    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>版本 {source.revision.identifier}</Text>
    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>许可 {source.license.identifier ?? '待核对'}</Text>
    <View style={styles.actions}>
      {links.original && <Button compact onPress={() => void open(links.original!, '菜谱原文')}>查看原文</Button>}
      {links.license && <Button compact onPress={() => void open(links.license!, '许可原文')}>查看许可</Button>}
    </View>
    {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{error}</Text>}
  </View>;
}

function RecipeBody({ recipe, ...props }: Props & Readonly<{ recipe: AppRecipe }>) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [consuming, setConsuming] = useState(false);
  const feasible = props.evaluation.tier === 'ready' || props.evaluation.tier === 'caveat';
  const steps = feasible ? props.evaluation.steps : recipe.steps;
  const sources = props.catalog.sources.filter(source => recipe.source_ids.includes(source.source_id));
  const upstream = sources.some(source => source.provenance.kind === 'upstream');
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Appbar.Header elevated={false} statusBarHeight={0}><Appbar.BackAction onPress={props.onBack} accessibilityLabel="返回推荐" />
      <Appbar.Content title="菜谱做法" /></Appbar.Header>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text variant="headlineLarge" style={styles.title}>{textOf(recipe.name)}</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>{recipe.time_minutes} 分钟 · {upstream ? '原文份量见下方' : `${recipe.servings} 人份`}</Text>
        {upstream && <Text style={{ color: theme.colors.onSurfaceVariant }}>{textOf(recipe.variant)}</Text>}
        {recipe.review_state !== 'reviewed' && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>菜谱内容待审核</Text>}
      </View>
      <RecipeStatus catalog={props.catalog} evaluation={props.evaluation} onOpenSettings={props.onOpenSettings} />
      <Text variant="titleLarge" style={styles.sectionTitle}>准备食材</Text>
      <Text style={{ color: theme.colors.onSurfaceVariant }}>用量均为整道菜的参考量</Text>
      <Surface elevation={0} style={[styles.ingredients, { backgroundColor: theme.colors.surface }]}>
        {recipe.requirements.map((requirement, index) => {
          const match = props.evaluation.requirements.find(item => item.requirement_id === requirement.requirement_id);
          if (!match) return null;
          return <View key={requirement.requirement_id}>
            {index > 0 && <Divider />}
            <RequirementRow catalog={props.catalog} requirement={requirement} match={match} update={props.update} onConfirmRule={props.onConfirmRule} />
          </View>;
        })}
      </Surface>
      <Text variant="titleLarge" style={styles.sectionTitle}>下厨步骤</Text>
      {!feasible && <Text style={{ color: theme.colors.onSurfaceVariant }}>原做法供参考，补齐并确认后可制作</Text>}
      {steps.map((step, index) => <StepRow key={step.step_id} catalog={props.catalog} step={step} index={index} />)}
      <Text variant="titleLarge" style={styles.sectionTitle}>菜谱来源</Text>
      {sources.map(source => <RecipeSource key={source.source_id} source={source} />)}
      {sources.length === 0 && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>来源待补充</Text>}
    </ScrollView>
    {feasible && <Surface elevation={1} style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
      <Button mode="contained" contentStyle={styles.mainButton} onPress={() => setConsuming(true)}>做了这道</Button>
    </Surface>}
    {consuming && <ConsumedDialog catalog={props.catalog} items={consumedItems(props.state, props.evaluation)}
      onDismiss={() => setConsuming(false)} onConfirm={props.onConsumed} />}
  </View>;
}

export function RecipeScreen(props: Props) {
  const recipe = props.catalog.recipes.find(item => item.recipe_id === props.evaluation.recipe_id);
  if (!recipe) return <View style={styles.empty}><Text>这份菜谱已不可用，请返回重新选择。</Text><Button onPress={props.onBack}>返回推荐</Button></View>;
  return <RecipeBody key={recipe.recipe_id} {...props} recipe={recipe} />;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36, gap: 12, width: '100%', maxWidth: 720, alignSelf: 'center' },
  heading: { gap: 8, paddingBottom: 8 },
  title: { fontWeight: '700' },
  status: { borderRadius: 18, padding: 18, gap: 8 },
  sectionTitle: { marginTop: 16, fontWeight: '700' },
  ingredients: { borderRadius: 18, overflow: 'hidden' },
  requirement: { padding: 16, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  grow: { flex: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2, justifyContent: 'flex-start' },
  note: { lineHeight: 22 },
  selfStart: { alignSelf: 'flex-start' },
  step: { flexDirection: 'row', gap: 14, paddingVertical: 10 },
  stepNumber: { minWidth: 24, paddingTop: 3 },
  stepText: { lineHeight: 27 },
  source: { gap: 6, paddingVertical: 8 },
  substitution: { padding: 12, borderRadius: 12, gap: 5, marginBottom: 10 },
  footer: { paddingHorizontal: 20, paddingVertical: 12 },
  mainButton: { minHeight: 48 },
  dialog: { maxWidth: 520, alignSelf: 'center', width: '90%' },
  dialogScroll: { maxHeight: 300 },
  empty: { padding: 20, gap: 12 },
});
