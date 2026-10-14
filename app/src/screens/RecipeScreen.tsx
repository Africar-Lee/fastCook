import { formatList, t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { Appbar, Button, Checkbox, Dialog, Divider, Portal, Snackbar, Surface, Text, useTheme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExecutionStep, RecipeEvaluation, Requirement, RequirementMatch, Step } from '../../../packages/engine/src/types';
import { EquipmentDialog } from '../components/EquipmentDialog';
import { RecipeReportDialog } from '../components/RecipeReportDialog';
import { addIngredient, markUnavailable } from '../model/inventory-actions';
import { equipmentLabels, formatQuantity, importanceLabels, nameOf, textOf, tierLabels } from '../model/presentation';
import { orderRequirements } from '../model/requirement-presentation';
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
  onAddMeal: () => void;
  inMeal: boolean;
  mealFull: boolean;
  onEdit?: () => void;
}>;

function matchLabel(match: RequirementMatch): string {
  if (match.omitted) return '已省略';
  if (match.presence === 'uncertain') return '需确认';
  if (match.presence === 'missing') return '缺少';
  if (match.match_kind === 'substitution') return '使用替代';
  if (match.match_kind === 'implicit') return '默认已有';
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
  if (match.presence !== 'uncertain') return '';
  const identity = uncertainIdentity(match);
  if (identity && match.used_ingredient_id) {
    return t('已选{selected}，需要{required}', { selected: nameOf(catalog, match.used_ingredient_id), required: nameOf(catalog, identity) });
  }
  return '';
}

function RequirementActions({ catalog, requirement, match, update, onConfirmRule }: Readonly<{
  catalog: AppCatalog; requirement: Requirement; match: RequirementMatch; update: UpdateKitchen; onConfirmRule: Props['onConfirmRule'];
}>) {
  useI18n();
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
      {t('确认是{ingredient}', { ingredient: nameOf(catalog, identity) })}
    </Button>}
    {match.presence === 'missing' && <Button compact mode="outlined" onPress={() => add(requirement.ingredient_id)}>
      {t('我有{ingredient}', { ingredient: nameOf(catalog, requirement.ingredient_id) })}
    </Button>}
    {Array.isArray(conditions) && conditions.map(id => <Button key={id} compact mode="outlined" onPress={() => add(id)}>
      {t('确认有{ingredient}', { ingredient: nameOf(catalog, id) })}
    </Button>)}
    {match.confirmation_key && <Button compact mode="outlined" onPress={() => onConfirmRule(match.confirmation_key!)}>
      {t('使用此替代')}
    </Button>}
    {!match.omitted && match.presence === 'present' && <Button compact onPress={remove}>{t('我没有')}</Button>}
  </View>;
}

function RequirementRow({ catalog, requirement, match, update, onConfirmRule }: Readonly<{
  catalog: AppCatalog; requirement: AppRequirement; match: RequirementMatch; update: UpdateKitchen; onConfirmRule: Props['onConfirmRule'];
}>) {
  useI18n();
  const theme = useTheme();
  const substitution = match.match_kind === 'substitution' && !match.omitted;
  const used = match.used_ingredient_id;
  const explanation = matchExplanation(catalog, match);
  const color = match.presence === 'missing' && !match.omitted ? theme.colors.error : theme.colors.onSurfaceVariant;
  return <View style={styles.requirement}>
    <View style={styles.row}>
      <Text variant="titleMedium" style={styles.grow}>{nameOf(catalog, requirement.ingredient_id)}</Text>
      <Text variant="labelMedium" style={{ color }}>{t(matchLabel(match))}</Text>
    </View>
    <Text style={{ color: theme.colors.onSurfaceVariant }}>
      {formatQuantity(requirement.quantity)} · {importanceLabels[requirement.importance]}
    </Text>
    {requirement.preparation && <Text style={{ color: theme.colors.onSurfaceVariant }}>{textOf(requirement.preparation)}</Text>}
    {substitution && used && <Text style={{ color: theme.colors.primary }}>
      {t('改用{ingredient}', { ingredient: nameOf(catalog, used) })}{match.quantity ? ` · ${formatQuantity(match.quantity)}` : ''}
    </Text>}
    {match.match_kind === 'approved_descendant' && used && <Text>{t('使用{ingredient}', { ingredient: nameOf(catalog, used) })}</Text>}
    {explanation.length > 0 && <Text>{explanation}</Text>}
    {match.note && <Text style={styles.note}>{textOf(match.note)}</Text>}
    <RequirementActions catalog={catalog} requirement={requirement} match={match} update={update} onConfirmRule={onConfirmRule} />
  </View>;
}

function RecipeStatus({ catalog, evaluation, onOpenEquipment }: Pick<Props, 'catalog' | 'evaluation'> & Readonly<{ onOpenEquipment: () => void }>) {
  useI18n();
  const theme = useTheme();
  return <Surface elevation={0} style={[styles.status, { backgroundColor: theme.colors.secondaryContainer }]}>
    <Text variant="titleMedium">{tierLabels[evaluation.tier]}</Text>
    {evaluation.missing_required_ingredient_ids.length > 0 && <Text>
      {t('缺少{items}', { items: formatList(evaluation.missing_required_ingredient_ids.map(id => nameOf(catalog, id))) })}
    </Text>}
    {evaluation.missing_equipment.length > 0 && <Text>
      {t('缺少{items}', { items: formatList(evaluation.missing_equipment.map(id => equipmentLabels[id])) })}
    </Text>}
    {evaluation.uncertain_equipment.length > 0 && <Text>
      {t('确认厨具 {equipment}', { equipment: formatList(evaluation.uncertain_equipment.map(id => equipmentLabels[id])) })}
    </Text>}
    {(evaluation.missing_equipment.length > 0 || evaluation.uncertain_equipment.length > 0) &&
      <Button mode="outlined" onPress={onOpenEquipment} style={styles.selfStart}>{t('设置厨具')}</Button>}
    {!evaluation.plan_valid && <Text>{t('用料调整冲突，请补齐原料')}</Text>}
  </Surface>;
}

function StepRow({ catalog, step, index }: Readonly<{ catalog: AppCatalog; step: Step | ExecutionStep; index: number }>) {
  useI18n();
  const theme = useTheme();
  const substitutions = 'substitutions' in step ? step.substitutions : [];
  return <View style={styles.step}>
    <Text variant="labelLarge" style={[styles.stepNumber, { color: theme.colors.primary }]}>{String(index + 1).padStart(2, '0')}</Text>
    <View style={styles.grow}>
      {substitutions.map(substitution => <Surface key={substitution.requirement_id} elevation={0}
        style={[styles.substitution, { backgroundColor: theme.colors.tertiaryContainer }]}>
        <Text variant="labelLarge">{t('{used}替代{original}', { used: nameOf(catalog, substitution.used_ingredient_id), original: nameOf(catalog, substitution.original_ingredient_id) })}</Text>
        <Text>{textOf(substitution.usage_note)}</Text>
        {substitution.recipe_quantity && <Text variant="bodySmall">
          {t('总用量 {quantity}', { quantity: formatQuantity(substitution.recipe_quantity) })}
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
  useI18n();
  const [selected, setSelected] = useState(() => new Set(items.map(item => `${item.location}_${item.ingredientId}`)));
  const toggle = (key: string) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return <Portal><Dialog visible onDismiss={onDismiss} style={styles.dialog}>
    <Dialog.Title>{t('用完了哪些食材？')}</Dialog.Title>
    <Dialog.ScrollArea style={styles.dialogScroll}><ScrollView>
      {items.map(item => {
        const key = `${item.location}_${item.ingredientId}`;
        return <Checkbox.Item key={key} label={`${nameOf(catalog, item.ingredientId)} · ${t(item.location === 'current' ? '本次食材' : '调料柜')}`}
          status={selected.has(key) ? 'checked' : 'unchecked'} onPress={() => toggle(key)} />;
      })}
      {items.length === 0 && <Text style={styles.empty}>{t('没有需要移除的食材')}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions><Button onPress={onDismiss}>{t('取消')}</Button><Button onPress={() => {
      onDismiss();
      onConfirm(items.filter(item => selected.has(`${item.location}_${item.ingredientId}`)));
    }}>{t('移除所选')}</Button></Dialog.Actions>
  </Dialog></Portal>;
}

function RecipeSource({ source }: Readonly<{ source: AppSource }>) {
  useI18n();
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);
  const links = sourceLinks(source);
  const open = async (value: string, label: string) => {
    const url = safeSourceUrl(value);
    if (!url) {
      setError(t('{label}地址不可用，请检查菜谱来源。', { label: t(label) }));
      return;
    }
    setError(null);
    const result = await Linking.openURL(url).then(
      () => ({ error: null }),
      () => ({ error: t('无法打开{label}，请检查浏览器是否可用后重试。', { label: t(label) }) }),
    );
    setError(result.error);
  };
  return <View style={styles.source}>
    <Text variant="titleSmall">{source.provenance.origin}</Text>
    <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('版本 {version}', { version: source.revision.identifier })}</Text>
    {source.license.identifier && <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>{t('许可 {license}', { license: source.license.identifier })}</Text>}
    <View style={styles.actions}>
      {links.original && <Button compact onPress={() => void open(links.original!, '菜谱原文')}>{t('查看原文')}</Button>}
      {links.license && <Button compact onPress={() => void open(links.license!, '许可原文')}>{t('查看许可')}</Button>}
    </View>
    {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{t(error)}</Text>}
  </View>;
}

function RecipeBody({ recipe, ...props }: Props & Readonly<{ recipe: AppRecipe }>) {
  useI18n();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [consuming, setConsuming] = useState(false);
  const [sourcesVisible, setSourcesVisible] = useState(false);
  const [equipmentVisible, setEquipmentVisible] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [reportNotice, setReportNotice] = useState<string | null>(null);
  const feasible = props.evaluation.tier === 'ready' || props.evaluation.tier === 'caveat';
  const steps = feasible ? props.evaluation.steps : recipe.steps;
  const sources = props.catalog.sources.filter(source => recipe.source_ids.includes(source.source_id));
  const upstream = sources.some(source => source.provenance.kind === 'upstream');
  return <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
    <Appbar.Header elevated={false} statusBarHeight={0}><Appbar.BackAction onPress={props.onBack} accessibilityLabel={t('返回推荐')} />
      <Appbar.Content title={t(props.onEdit ? '我的菜谱' : '菜谱做法')} />
      {props.onEdit && <Appbar.Action icon="pencil-outline" accessibilityLabel={t('编辑菜谱')} onPress={props.onEdit} />}
    </Appbar.Header>
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.heading}>
        <Text variant="headlineLarge" style={styles.title}>{textOf(recipe.name)}</Text>
        <Text style={{ color: theme.colors.onSurfaceVariant }}>{t('{minutes} 分钟', { minutes: recipe.time_minutes })}{!upstream && ` · ${t('{count} 人份', { count: recipe.servings })}`}</Text>
      </View>
      <RecipeStatus catalog={props.catalog} evaluation={props.evaluation} onOpenEquipment={() => setEquipmentVisible(true)} />
      <Text variant="titleLarge" style={styles.sectionTitle}>{t('食材用量')}</Text>
      <Surface elevation={0} style={[styles.ingredients, { backgroundColor: theme.colors.surface }]}>
        {orderRequirements(recipe.requirements, props.evaluation.requirements).map(({ requirement, match }, index) =>
          <View key={requirement.requirement_id}>
            {index > 0 && <Divider />}
            <RequirementRow catalog={props.catalog} requirement={requirement} match={match} update={props.update} onConfirmRule={props.onConfirmRule} />
          </View>)}
      </Surface>
      <Text variant="titleLarge" style={styles.sectionTitle}>{t('下厨步骤')}</Text>
      {steps.map((step, index) => <StepRow key={step.step_id} catalog={props.catalog} step={step} index={index} />)}
      <View>
        <View style={styles.actions}>
          {sources.length > 0 && <Button icon={sourcesVisible ? 'chevron-up' : 'chevron-down'} onPress={() => setSourcesVisible(previous => !previous)}
            accessibilityState={{ expanded: sourcesVisible }}>{t('菜谱来源')}</Button>}
          {!props.onEdit && <Button icon="flag-outline" onPress={() => setReportVisible(true)}>{t('报告问题')}</Button>}
        </View>
        {sourcesVisible && <>
          {upstream && <Text style={{ color: theme.colors.onSurfaceVariant }}>{textOf(recipe.variant)}</Text>}
          {sources.map(source => <RecipeSource key={source.source_id} source={source} />)}
        </>}
      </View>
    </ScrollView>
    <Surface elevation={1} style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
      <Button mode="outlined" icon={props.inMeal ? 'check' : 'plus'} disabled={props.inMeal || props.mealFull}
        onPress={props.onAddMeal}>{t(props.inMeal ? '已加入这顿' : '加入这顿')}</Button>
      {feasible && <Button mode="contained" contentStyle={styles.mainButton} onPress={() => setConsuming(true)}>{t('做了这道')}</Button>}
    </Surface>
    {consuming && <ConsumedDialog catalog={props.catalog} items={consumedItems(props.state, props.evaluation)}
      onDismiss={() => setConsuming(false)} onConfirm={props.onConsumed} />}
    {equipmentVisible && <EquipmentDialog initialSelection={props.state.equipmentConfigured ? props.state.equipment : ['wok', 'pot']}
      onDismiss={() => setEquipmentVisible(false)} onSave={equipment => {
        props.update(previous => ({ ...previous, equipment, equipmentConfigured: true }));
        setEquipmentVisible(false);
      }} />}
    {reportVisible && <RecipeReportDialog catalog={props.catalog} recipeId={recipe.recipe_id}
      onDismiss={() => setReportVisible(false)} onExported={message => { setReportVisible(false); setReportNotice(message); }} />}
    <Snackbar visible={reportNotice !== null} onDismiss={() => setReportNotice(null)} duration={4000}>
      {reportNotice ? t(reportNotice) : ''}
    </Snackbar>
  </View>;
}

export function RecipeScreen(props: Props) {
  useI18n();
  const recipe = props.catalog.recipes.find(item => item.recipe_id === props.evaluation.recipe_id);
  if (!recipe) return <View style={styles.empty}><Text>{t('这份菜谱已不可用，请返回重新选择。')}</Text><Button onPress={props.onBack}>{t('返回推荐')}</Button></View>;
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
  footer: { paddingHorizontal: 20, paddingVertical: 12, gap: 8 },
  mainButton: { minHeight: 48 },
  dialog: { maxWidth: 520, alignSelf: 'center', width: '90%' },
  dialogScroll: { maxHeight: 300 },
  empty: { padding: 20, gap: 12 },
});
