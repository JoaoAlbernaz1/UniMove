import {
  ArrowLeft,
  CalendarDays,
  CarFront,
  Check,
  Circle,
  Clock3,
  MapPin,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PublishedRide, RideLocation, RideVehicle } from '../api/rides';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { SelectionField } from '../components/SelectionField';
import { TextField } from '../components/TextField';
import {
  formatRideDate,
  formatRidePrice,
  formatRideTime,
  initialOfferRide,
  offerRideInput,
  type OfferRideDraft,
} from '../offerRide';
import { colors, fonts, maxContentWidth, radius } from '../theme';

const preferences = [
  { key: 'acceptsLuggage', label: 'Aceita bagagem' },
  { key: 'allowsMusic', label: 'Permite música' },
  { key: 'acceptsPets', label: 'Aceita pets' },
] as const;

export function OfferRideScreen({ onBack }: { onBack: () => void }) {
  const { authApi } = useAuth();
  const [draft, setDraft] = useState<OfferRideDraft>(initialOfferRide);
  const [locations, setLocations] = useState<RideLocation[]>([]);
  const [vehicles, setVehicles] = useState<RideVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [focusedControl, setFocusedControl] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      authApi<RideLocation[]>('/locations'),
      authApi<RideVehicle[]>('/vehicles'),
    ])
      .then(([nextLocations, nextVehicles]) => {
        if (active) {
          setLocations(nextLocations);
          setVehicles(nextVehicles);
        }
      })
      .catch((error: unknown) => {
        if (active)
          setLoadError(
            error instanceof Error
              ? error.message
              : 'Não foi possível carregar os locais e veículos.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authApi, attempt]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (!submitting.current) onBack();
        return true;
      },
    );
    return () => subscription.remove();
  }, [onBack]);

  const update = useCallback(
    <K extends keyof OfferRideDraft>(key: K, value: OfferRideDraft[K]) => {
      setDraft((current) => ({ ...current, [key]: value }));
      setSubmitError(null);
    },
    [],
  );

  const vehicle = vehicles.find((item) => item.id === draft.vehicleId);
  const locationOptions = locations.map((item) => ({
    value: item.id,
    label: item.name,
  }));
  const unavailable =
    loading || !!loadError || !locations.length || !vehicles.length;

  function selectVehicle(id: string) {
    const capacity =
      vehicles.find((item) => item.id === id)?.passengerCapacity ?? 0;
    update('vehicleId', id);
    if (draft.availableSeats && draft.availableSeats > capacity)
      update('availableSeats', null);
  }

  async function publish() {
    if (submitting.current || published || unavailable) return;
    submitting.current = true;
    setPublishing(true);
    setSubmitError(null);
    try {
      await authApi<PublishedRide>('/rides', {
        method: 'POST',
        body: JSON.stringify(offerRideInput(draft)),
      });
      setPublished(true);
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'Não foi possível publicar a carona. Tente novamente.',
      );
    } finally {
      submitting.current = false;
      setPublishing(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.flex}>
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <Pressable
              onPress={onBack}
              disabled={publishing}
              style={styles.back}
              accessibilityRole="button"
              accessibilityLabel="Voltar para início"
              accessibilityState={{ disabled: publishing }}
            >
              <ArrowLeft size={22} color={colors.white} />
            </Pressable>
            <Text style={styles.title} accessibilityRole="header">
              Oferecer Carona
            </Text>
          </View>
        </View>

        {published ? (
          <View style={styles.success}>
            <View style={styles.successContent}>
              <Message tone="success">Carona publicada com sucesso!</Message>
              <Text style={styles.successText}>
                Sua carona já está disponível para a comunidade acadêmica.
              </Text>
              <Button
                title="Voltar para início"
                variant="accent"
                onPress={onBack}
              />
            </View>
          </View>
        ) : (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={styles.form}
                pointerEvents={publishing ? 'none' : 'auto'}
              >
                {loading ? (
                  <ActivityIndicator
                    color={colors.accentDark}
                    accessibilityLabel="Carregando locais e veículos"
                  />
                ) : null}
                {loadError ? (
                  <>
                    <Message tone="error">{loadError}</Message>
                    <Button
                      title="Tentar novamente"
                      variant="outline"
                      onPress={() => {
                        setLoading(true);
                        setLoadError(null);
                        setAttempt((value) => value + 1);
                      }}
                    />
                  </>
                ) : null}
                {!loading && !loadError && !vehicles.length ? (
                  <Message tone="error">
                    Cadastre um veículo na sua conta antes de oferecer uma
                    carona.
                  </Message>
                ) : null}
                {!loading && !loadError && !locations.length ? (
                  <Message tone="error">
                    Não há locais disponíveis. Solicite o cadastro dos locais ao
                    administrador.
                  </Message>
                ) : null}

                <View style={styles.section}>
                  <Text style={styles.label}>Trajeto</Text>
                  <SelectionField
                    label="Origem"
                    hideLabel
                    placeholder="De onde você sai?"
                    icon={Circle}
                    iconColor={colors.accent}
                    value={draft.originLocationId}
                    options={locationOptions}
                    onChange={(value) => update('originLocationId', value)}

                    disabled={unavailable}
                  />
                  <SelectionField
                    label="Destino"
                    hideLabel
                    placeholder="Para onde você vai?"
                    icon={MapPin}
                    value={draft.destinationLocationId}
                    options={locationOptions}
                    onChange={(value) => update('destinationLocationId', value)}

                    disabled={unavailable}
                  />
                </View>

                <View style={styles.section}>
                  <Text style={styles.label}>Data e Hora</Text>
                  <View style={styles.row}>
                    <View style={styles.half}>
                      <TextField
                        label="Data de saída"
                        hideLabel
                        icon={CalendarDays}
                        placeholder="dd/mm/aaaa"
                        value={draft.date}
                        onChangeText={(value) =>
                          update('date', formatRideDate(value))
                        }
                        keyboardType="number-pad"
                        maxLength={10}
                        editable={!publishing}
                      />
                    </View>
                    <View style={styles.half}>
                      <TextField
                        label="Horário de saída"
                        hideLabel
                        icon={Clock3}
                        placeholder="--:--"
                        value={draft.time}
                        onChangeText={(value) =>
                          update('time', formatRideTime(value))
                        }
                        keyboardType="number-pad"
                        maxLength={5}
                        editable={!publishing}
                      />
                    </View>
                  </View>
                </View>

                <SelectionField
                  label="Veículo"
                  placeholder="Modelo do veículo"
                  icon={CarFront}
                  value={draft.vehicleId}
                  options={vehicles.map((item) => ({
                    value: item.id,
                    label: `${item.brand} ${item.model} • ${item.plate}`,
                  }))}
                  onChange={selectVehicle}

                  disabled={unavailable}
                />

                <View style={styles.section}>
                  <Text style={styles.label}>Vagas Disponíveis</Text>
                  <View
                    style={styles.row}
                    accessibilityRole="radiogroup"
                    accessibilityLabel="Vagas disponíveis"
                  >
                    {[1, 2, 3, 4].map((seats) => {
                      const selected = draft.availableSeats === seats;
                      const disabled =
                        publishing ||
                        (!!vehicle && seats > vehicle.passengerCapacity);
                      return (
                        <Pressable
                          key={seats}
                          accessibilityRole="radio"
                          accessibilityLabel={`${seats} ${seats === 1 ? 'vaga' : 'vagas'}`}
                          accessibilityState={{ checked: selected, disabled }}
                          disabled={disabled}
                          onFocus={() => setFocusedControl(`seat-${seats}`)}
                          onBlur={() => setFocusedControl(null)}
                          onPress={() => update('availableSeats', seats)}
                          style={({ pressed }) => [
                            styles.seat,
                            selected && styles.selectedSeat,
                            focusedControl === `seat-${seats}` &&
                              styles.focused,
                            (disabled || pressed) && styles.dimmed,
                          ]}
                        >
                          <Text
                            style={[
                              styles.seatText,
                              selected && styles.selectedText,
                            ]}
                          >
                            {seats}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <TextField
                  label="Preço por Pessoa"
                  prefix="R$"
                  placeholder="0,00"
                  keyboardType="number-pad"
                  value={draft.price}
                  onChangeText={(value) =>
                    update('price', formatRidePrice(value))
                  }

                  editable={!publishing}
                />
                <TextField
                  label="Informações Adicionais"
                  placeholder="Ex: Ponto de encontro, preferências, etc."
                  multiline
                  maxLength={1000}
                  value={draft.additionalInfo}
                  onChangeText={(value) => update('additionalInfo', value)}

                  editable={!publishing}
                />

                <View style={styles.section}>
                  <Text style={styles.label}>Preferências</Text>
                  <View style={styles.preferences}>
                    {preferences.map(({ key, label }) => (
                      <Pressable
                        key={key}
                        accessibilityRole="checkbox"
                        accessibilityLabel={label}
                        accessibilityState={{
                          checked: draft[key],
                          disabled: publishing,
                        }}
                        disabled={publishing}
                        onFocus={() => setFocusedControl(key)}
                        onBlur={() => setFocusedControl(null)}
                        onPress={() => update(key, !draft[key])}
                        style={({ pressed }) => [
                          styles.preference,
                          focusedControl === key && styles.focused,
                          pressed && styles.dimmed,
                        ]}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            draft[key] && styles.checked,
                          ]}
                        >
                          {draft[key] ? (
                            <Check
                              size={14}
                              strokeWidth={3}
                              color={colors.white}
                            />
                          ) : null}
                        </View>
                        <Text style={styles.preferenceText}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <View style={styles.footerContent}>
                {submitError ? (
                  <Message tone="error">{submitError}</Message>
                ) : null}
                <Button
                  title="Publicar Carona"
                  variant="accent"
                  loading={publishing}
                  disabled={unavailable}
                  onPress={() => void publish()}
                />
              </View>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safe: { flex: 1, backgroundColor: colors.primary },
  header: { backgroundColor: colors.primary, alignItems: 'center' },
  headerContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    gap: 4,
  },
  back: {
    width: 40,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
    color: colors.white,
  },
  scroll: {
    flexGrow: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  form: { width: '100%', maxWidth: maxContentWidth, padding: 24, gap: 20 },
  section: { gap: 10 },
  label: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.primary,
  },
  row: { flexDirection: 'row', gap: 12 },
  half: { flex: 1, minWidth: 0 },
  seat: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius,
  },
  seatText: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
  selectedSeat: {
    borderColor: colors.accentDark,
    backgroundColor: colors.accentBg,
  },
  selectedText: { color: colors.accentDark },
  focused: { borderColor: colors.accentDark },
  dimmed: { opacity: 0.5 },
  preferences: { gap: 8 },
  preference: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 2,
  },
  checked: {
    borderColor: colors.accentDark,
    backgroundColor: colors.accentDark,
  },
  preferenceText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    color: colors.primary,
  },
  error: {
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.destructive,
  },
  footer: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: 'center',
  },
  footerContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    paddingHorizontal: 24,
    paddingVertical: 22,
    gap: 12,
  },
  success: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
    padding: 24,
  },
  successContent: { width: '100%', maxWidth: maxContentWidth, gap: 20 },
  successText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 22,
    color: colors.muted,
  },
});
