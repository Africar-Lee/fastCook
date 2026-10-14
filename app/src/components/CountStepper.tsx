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
  return <View style={styles.row}>
    <Text variant="titleMedium" style={styles.label}>{label}</Text>
    <View style={styles.controls}>
      <IconButton icon="minus" mode="outlined" size={18} disabled={value <= min}
        accessibilityLabel={`减少${label}`} onPress={() => onChange(Math.max(min, value - 1))} />
      <Text variant="titleMedium" style={styles.value} accessibilityLabel={`${label}，${value}`}>{value}</Text>
      <IconButton icon="plus" mode="outlined" size={18} disabled={value >= max}
        accessibilityLabel={`增加${label}`} onPress={() => onChange(Math.min(max, value + 1))} />
    </View>
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flexShrink: 1 }, controls: { flexDirection: 'row', alignItems: 'center' },
  value: { minWidth: 28, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
