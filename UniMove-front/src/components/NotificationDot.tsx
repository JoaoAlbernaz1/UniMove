import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

export function NotificationDot() {
  return <View pointerEvents="none" accessible={false} style={styles.dot} />;
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -6,
    right: 18,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.destructive,
  },
});
