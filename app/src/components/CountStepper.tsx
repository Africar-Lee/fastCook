import { t } from '../i18n/core';
import { useI18n } from '../i18n/useI18n';
import { StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';

type Props = Readonly<{
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}>;

export function CountStepper({ label, value, min, max, onChange }: Props) {
  useI18n();
  return <View style={styles.row}>
    <Text variant="titleMedium" style={styles.label}>{t(label)}</Text>
    <View style={styles.controls}>
      <IconButton icon="minus" mode="outlined" size={18} disabled={value <= min}
        accessibilityLabel={t('减少{label}', { label: t(label) })} onPress={() => onChange(Math.max(min, value - 1))} />
      <Text variant="titleMedium" style={styles.value} accessibilityLabel={t('{label}，{value}', { label: t(label), value })}>{value}</Text>
      <IconButton icon="plus" mode="outlined" size={18} disabled={value >= max}
        accessibilityLabel={t('增加{label}', { label: t(label) })} onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flexShrink: 1 }, controls: { flexDirection: 'row', alignItems: 'center' },
  value: { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
