import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SvgXml } from 'react-native-svg';
import { advertisements } from '../content/advertisements';
import { colors, maxContentWidth } from '../theme';

const GAP = 4;
const PIXELS_PER_SECOND = 28;

export function AdvertisementBar() {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [translation] = useState(() => new Animated.Value(0));
  const [holding, setHolding] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const paused = holding || reduceMotion;
  const [active, setActive] = useState(
    () =>
      AppState.currentState !== 'background' &&
      AppState.currentState !== 'inactive',
  );
  // Mantém a proporção 600 × 88 dos banners sem criar margens laterais vazias.
  const bannerWidth = Math.min(300, viewportWidth || 300);
  const cycleWidth = (bannerWidth + GAP) * advertisements.length;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled);
      })
      .catch(() => {});
    const motion = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      (enabled) => {
        setReduceMotion(enabled);
      },
    );
    const appState = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state !== 'active') setHolding(false);
    });
    return () => {
      mounted = false;
      motion.remove();
      appState.remove();
    };
  }, []);

  useEffect(() => {
    if (!viewportWidth) return;
    let cancelled = false;
    let animation: Animated.CompositeAnimation | undefined;

    function moveRight(from: number) {
      if (cancelled) return;
      animation = Animated.timing(translation, {
        toValue: 0,
        duration: Math.max(1, (Math.abs(from) / PIXELS_PER_SECOND) * 1000),
        easing: Easing.linear,
        useNativeDriver: Platform.OS !== 'web',
        isInteraction: false,
      });
      animation.start(({ finished }) => {
        if (!finished || cancelled) return;
        // As cópias são idênticas: a troca de posição mantém o ciclo contínuo.
        translation.setValue(-cycleWidth);
        moveRight(-cycleWidth);
      });
    }

    translation.stopAnimation((current: number) => {
      if (cancelled) return;
      const from =
        current >= 0 || current < -cycleWidth ? -cycleWidth : current;
      translation.setValue(from);
      if (!paused && active) moveRight(from);
    });
    return () => {
      cancelled = true;
      animation?.stop();
    };
  }, [active, cycleWidth, paused, translation, viewportWidth]);

  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.safe}>
      <View style={styles.content}>
        <Pressable
          style={styles.viewport}
          onPressIn={() => setHolding(true)}
          onPressOut={() => setHolding(false)}
          onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityRole="image"
          accessibilityLabel={`Publicidade. ${advertisements.map((ad) => ad.description).join(' ')}`}
          accessibilityHint="Mantenha pressionado para pausar a rolagem. Solte para continuar."
        >
          <Animated.View
            style={[
              styles.track,
              {
                width: cycleWidth * 2,
                transform: [{ translateX: translation }],
              },
            ]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            {[0, 1].map((copy) =>
              advertisements.map((ad) => (
                <View
                  key={`${copy}-${ad.id}`}
                  style={[
                    styles.banner,
                    { width: bannerWidth, marginRight: GAP },
                  ]}
                >
                  {ad.image ? (
                    <Image
                      source={ad.image}
                      resizeMode="contain"
                      style={styles.image}
                      accessible={false}
                    />
                  ) : (
                    <SvgXml
                      xml={ad.demonstrationSvg}
                      width="100%"
                      height="100%"
                    />
                  )}
                </View>
              )),
            )}
          </Animated.View>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.primary, alignItems: 'center' },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    minHeight: 56,
  },
  viewport: { flex: 1, height: 44, overflow: 'hidden' },
  track: { flexDirection: 'row', height: 44 },
  banner: { height: 44, justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
});
