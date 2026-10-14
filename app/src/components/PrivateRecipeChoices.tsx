import { ScrollView, StyleSheet, View } from 'react-native';
import { Chip, Text } from 'react-native-paper';
import { useI18n } from '../i18n/useI18n';

type Props<T extends string> = Readonly<{
  label?: string;
  values: Readonly<Record<T, string>>;
  selected: readonly T[];
  onSelect: (value: T) => void;
  horizontal?: boolean;
}>;

export function PrivateRecipeChoices<T extends string>({ label, values, selected, onSelect, horizontal = false }: Props<T>) {
  const { t } = useI18n();
  const chips = (Object.keys(values) as T[]).map(value => <Chip key={value} selected={selected.includes(value)}
    showSelectedCheck={false} onPress={() => onSelect(value)}>{t(values[value])}</Chip>);
  return <View style={styles.section}>
    {label && <Text variant="titleSmall">{t(label)}</Text>}
    {horizontal ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>{chips}</ScrollView>
      : <View style={styles.row}>{chips}</View>}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
