import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, Portal, Text, TextInput, useTheme } from 'react-native-paper';
import appConfig from '../../app.json';
import { createRecipeReport, MAX_REPORT_DESCRIPTION_LENGTH, reportCategoryLabels } from '../model/recipe-report';
import type { RecipeReport } from '../model/recipe-report';
import type { AppCatalog } from '../model/types';
import { exportRecipeReport } from '../storage/report-export';

type Category = RecipeReport['issue']['category'];
type Props = Readonly<{
  catalog: AppCatalog;
  recipeId: string;
  onDismiss: () => void;
  onExported: (message: string) => void;
}>;

function ReportForm({ category, description, onCategoryChange, onDescriptionChange }: Readonly<{
  category: Category; description: string;
  onCategoryChange: (value: Category) => void; onDescriptionChange: (value: string) => void;
}>) {
  return <View style={styles.form}>
    <View style={styles.categories}>{(Object.keys(reportCategoryLabels) as Category[]).map(value =>
      <Chip key={value} selected={category === value} showSelectedCheck mode="outlined"
        accessibilityLabel={`${reportCategoryLabels[value]}，${category === value ? '已选' : '未选'}`}
        onPress={() => onCategoryChange(value)}>{reportCategoryLabels[value]}</Chip>)}</View>
    <TextInput label="问题描述" accessibilityLabel="问题描述" mode="outlined" multiline
      value={description} onChangeText={onDescriptionChange} maxLength={MAX_REPORT_DESCRIPTION_LENGTH}
      style={styles.input} contentStyle={styles.inputContent} />
  </View>;
}

export function RecipeReportDialog({ catalog, recipeId, onDismiss, onExported }: Props) {
  const theme = useTheme();
  const [category, setCategory] = useState<Category>('ingredients');
  const [description, setDescription] = useState('');
  const [report, setReport] = useState<RecipeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const inFlight = useRef(false);
  const preview = () => {
    const result = createRecipeReport(catalog, recipeId, appConfig.expo.version, { category, description });
    setError(result.error);
    setReport(result.data);
  };
  const save = async () => {
    if (!report || inFlight.current) return;
    inFlight.current = true;
    setExporting(true);
    setError(null);
    const result = await exportRecipeReport(report);
    inFlight.current = false;
    setExporting(false);
    if (result.status === 'failed') { setError(result.error); return; }
    if (result.status === 'cancelled') return;
    onExported(result.status === 'saved' ? '报告已保存到所选文件夹' : '已开始下载报告');
  };
  return <Portal><Dialog visible onDismiss={() => { if (!inFlight.current) onDismiss(); }} style={styles.dialog}>
    <Dialog.Title>{report ? '报告内容' : '报告问题'}</Dialog.Title>
    <Dialog.ScrollArea style={styles.scroll}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {report ? <Text selectable variant="bodySmall" style={styles.json}>{JSON.stringify(report, null, 2)}</Text>
        : <ReportForm category={category} description={description}
          onCategoryChange={value => { setCategory(value); setError(null); }}
          onDescriptionChange={value => { setDescription(value); setError(null); }} />}
      {error && <Text accessibilityRole="alert" style={{ color: theme.colors.error }}>{error}</Text>}
    </ScrollView></Dialog.ScrollArea>
    <Dialog.Actions>
      <Button disabled={exporting} onPress={report ? () => { setReport(null); setError(null); } : onDismiss}>
        {report ? '返回修改' : '取消'}
      </Button>
      <Button mode="contained" disabled={exporting} loading={exporting} onPress={report ? () => void save() : preview}>
        {report ? '导出 JSON' : '预览报告'}
      </Button>
    </Dialog.Actions>
  </Dialog></Portal>;
}

const styles = StyleSheet.create({
  dialog: { maxWidth: 520, width: '90%', maxHeight: '90%', alignSelf: 'center' },
  scroll: { maxHeight: 420, flexShrink: 1 },
  content: { gap: 16, paddingVertical: 16 },
  form: { gap: 16 }, categories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { minHeight: 140 }, inputContent: { textAlignVertical: 'top' },
  json: { fontFamily: 'monospace', lineHeight: 21 },
});
