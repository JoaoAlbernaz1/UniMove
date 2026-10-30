import { ArrowLeft, Car, Users } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import {
  ActivityIndicator,
  BackHandler,
  Image,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createVehicle,
  getVehicleRegistrationPolicy,
  getVehicles,
  getDriverLicense,
  updateVehicle,
  type Vehicle,
  type VehicleRegistrationPolicy,
} from '../api/vehicles';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../components/Button';
import { Message } from '../components/Message';
import { SelectionField } from '../components/SelectionField';
import { TextField } from '../components/TextField';
import { colors, fonts, maxContentWidth, radius } from '../theme';
import {
  vehicleColorInput,
  vehicleNameInput,
  vehiclePlateInput,
  vehicleYearInput,
} from '../vehicleInput';

export function RegisterVehicleScreen({
  onBack,
  onOfferRide,
}: {
  onBack: () => void;
  onOfferRide: () => void;
}) {
  const { authApi, refreshSession } = useAuth();
  const [policy, setPolicy] = useState<VehicleRegistrationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState({
    brand: '',
    model: '',
    color: '',
    plate: '',
    year: '',
    capacity: '',
  });
  const [saving, setSaving] = useState(false);
  const [savedVehicle, setSavedVehicle] = useState<Vehicle | null>(null);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [licensePhoto, setLicensePhoto] =
    useState<ImagePicker.ImagePickerAsset | null>(null);
  const [hasLicense, setHasLicense] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const submitting = useRef(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      getVehicleRegistrationPolicy(authApi),
      getVehicles(authApi),
      getDriverLicense(authApi),
    ])
      .then(([result, existing, license]) => {
        if (active) {
          setPolicy(result);
          setVehicles(existing);
          setHasLicense(license.uploaded);
          if (existing[0]) fillVehicle(existing[0]);
        }
      })
      .catch((reason: unknown) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar o formulário.',
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

  function fillVehicle(vehicle: Vehicle) {
    setEditingVehicle(vehicle);
    setDraft({
      brand: vehicle.brand,
      model: vehicle.model,
      color: vehicle.color,
      plate: vehicle.plate,
      year: String(vehicle.year),
      capacity: String(vehicle.passengerCapacity),
    });
    setError(null);
  }

  function update(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  async function selectPhoto(camera = false) {
    setPhotoError(null);
    try {
      if (camera && Platform.OS !== 'web') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setPhotoError(
            'Permita o acesso à câmera ou selecione uma foto da galeria.',
          );
          return;
        }
      }
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsMultipleSelection: false,
        quality: 0.9,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!result.canceled) {
        setLicensePhoto(result.assets[0]);
        setError(null);
      }
    } catch {
      setPhotoError(
        'Não foi possível abrir a foto. Tente novamente ou escolha outra imagem.',
      );
    }
  }

  async function save() {
    if (submitting.current || !policy) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    let persisted = !!savedVehicle;
    try {
      if (!savedVehicle) {
        const input = {
          brand: draft.brand,
          model: draft.model,
          color: draft.color,
          plate: draft.plate,
          year: draft.year.trim() ? Number(draft.year) : NaN,
          passengerCapacity: draft.capacity ? Number(draft.capacity) : NaN,
        };
        const vehicle = editingVehicle
          ? await updateVehicle(authApi, editingVehicle.id, input, licensePhoto)
          : await createVehicle(authApi, input, licensePhoto);
        setSavedVehicle(vehicle);
        persisted = true;
      }
      // O papel já está no banco; renova o JWT para liberar a publicação imediatamente.
      await refreshSession();
      setPermissionsReady(true);
    } catch (reason) {
      setError(
        persisted
          ? 'Seu carro foi salvo, mas não foi possível atualizar seu acesso. Tente novamente abaixo.'
          : reason instanceof Error
            ? reason.message
            : 'Não foi possível salvar o carro. Tente novamente.',
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={onBack}
            disabled={saving}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Voltar para o perfil"
            accessibilityState={{ disabled: saving }}
          >
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {editingVehicle ? 'Editar carro' : 'Cadastre seu carro'}
          </Text>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.form}>
          {loading ? (
            <ActivityIndicator
              color={colors.accent}
              accessibilityLabel="Carregando formulário"
            />
          ) : loadError ? (
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
          ) : savedVehicle ? (
            <>
              <Message tone="success">
                {editingVehicle
                  ? 'Carro atualizado com sucesso!'
                  : 'Carro cadastrado com sucesso!'}
              </Message>
              <Text style={styles.description}>
                {savedVehicle.brand} {savedVehicle.model} · {savedVehicle.plate}
              </Text>
              {permissionsReady ? (
                <>
                  <Text style={styles.description}>
                    {editingVehicle
                      ? 'As alterações do seu carro foram salvas.'
                      : 'Você agora pode oferecer caronas e continuar buscando caronas com a mesma conta.'}
                  </Text>
                  <Button
                    title="Oferecer carona"
                    onPress={onOfferRide}
                    variant="accent"
                    icon={Car}
                  />
                  <Button
                    title="Voltar para o perfil"
                    onPress={onBack}
                    variant="outline"
                  />
                </>
              ) : (
                <>
                  {error ? <Message tone="error">{error}</Message> : null}
                  <Button
                    title="Atualizar acesso"
                    onPress={() => void save()}
                    loading={saving}
                    variant="accent"
                  />
                </>
              )}
            </>
          ) : policy ? (
            <>
              <Text style={styles.description}>
                {editingVehicle
                  ? 'Atualize os dados do seu veículo.'
                  : 'Cadastre seu veículo para oferecer caronas à comunidade acadêmica.'}
              </Text>
              {vehicles.length > 1 ? (
                <SelectionField
                  label="Veículo"
                  presentation="dropdown"
                  icon={Car}
                  placeholder="Selecione o carro"
                  value={editingVehicle?.id ?? ''}
                  options={vehicles.map((vehicle) => ({
                    value: vehicle.id,
                    label: `${vehicle.brand} ${vehicle.model} · ${vehicle.plate}`,
                  }))}
                  onChange={(id) => {
                    const vehicle = vehicles.find((item) => item.id === id);
                    if (vehicle) fillVehicle(vehicle);
                  }}
                  disabled={saving}
                />
              ) : null}
              <TextField
                label="Marca"
                placeholder="Ex.: Chevrolet"
                value={draft.brand}
                onChangeText={(value) =>
                  update('brand', vehicleNameInput(value))
                }
                maxLength={policy.fieldMaxLengths.brand}
                editable={!saving}
              />
              <TextField
                label="Modelo"
                placeholder="Ex.: Spin"
                value={draft.model}
                onChangeText={(value) =>
                  update('model', vehicleNameInput(value))
                }
                maxLength={policy.fieldMaxLengths.model}
                editable={!saving}
              />
              <TextField
                label="Cor"
                placeholder="Ex.: Prata"
                value={draft.color}
                onChangeText={(value) =>
                  update('color', vehicleColorInput(value))
                }
                maxLength={policy.fieldMaxLengths.color}
                editable={!saving}
              />
              <TextField
                label="Placa"
                placeholder="ABC1D23 ou ABC1234"
                autoCapitalize="characters"
                autoCorrect={false}
                value={draft.plate}
                onChangeText={(value) =>
                  update(
                    'plate',
                    vehiclePlateInput(value, policy.fieldMaxLengths.plate),
                  )
                }
                editable={!saving}
              />
              <TextField
                label="Ano do modelo"
                placeholder={`Ex.: ${policy.maxYear}`}
                hint={`De ${policy.minYear} até ${policy.maxYear}.`}
                keyboardType="number-pad"
                value={draft.year}
                onChangeText={(value) =>
                  update(
                    'year',
                    vehicleYearInput(value, policy.fieldMaxLengths.year),
                  )
                }
                maxLength={policy.fieldMaxLengths.year}
                editable={!saving}
              />
              <SelectionField
                label="Vagas para passageiros"
                presentation="dropdown"
                icon={Users}
                placeholder="Selecione a quantidade"
                value={draft.capacity}
                options={Array.from(
                  {
                    length:
                      policy.maxPassengerCapacity -
                      policy.minPassengerCapacity +
                      1,
                  },
                  (_, index) => {
                    const seats = policy.minPassengerCapacity + index;
                    return {
                      value: String(seats),
                      label: `${seats} ${seats === 1 ? 'vaga' : 'vagas'}`,
                    };
                  },
                )}
                onChange={(value) => update('capacity', value)}
                disabled={saving}
              />
              <Text style={styles.description}>
                Informe somente os assentos dos passageiros, sem contar o
                motorista.
              </Text>
              <View style={styles.photoSection}>
                <Text style={styles.photoLabel}>Foto da CNH *</Text>
                <Text style={styles.description}>
                  {hasLicense && !licensePhoto
                    ? 'Sua CNH já foi enviada. Você pode manter a foto ou substituí-la.'
                    : 'Envie uma foto nítida da sua CNH. O envio é obrigatório para oferecer carona.'}
                </Text>
                <Text style={styles.description}>
                  {policy.driverLicense.formats.join(', ')} · Até{' '}
                  {policy.driverLicense.maxBytes / (1024 * 1024)} MB
                </Text>
                {licensePhoto ? (
                  <Image
                    source={{ uri: licensePhoto.uri }}
                    style={styles.photo}
                    resizeMode="contain"
                    accessibilityLabel="Prévia da foto da CNH selecionada"
                  />
                ) : null}
                <Button
                  title={
                    licensePhoto || hasLicense
                      ? 'Trocar foto da CNH'
                      : 'Selecionar foto da CNH'
                  }
                  onPress={() => void selectPhoto()}
                  variant="outline"
                  disabled={saving}
                />
                {Platform.OS !== 'web' ? (
                  <Button
                    title="Tirar foto da CNH"
                    onPress={() => void selectPhoto(true)}
                    variant="outline"
                    disabled={saving}
                  />
                ) : null}
                {photoError ? (
                  <Message tone="error">{photoError}</Message>
                ) : null}
              </View>
              {error ? <Message tone="error">{error}</Message> : null}
              <Button
                title={editingVehicle ? 'Salvar alterações' : 'Cadastrar carro'}
                onPress={() => void save()}
                loading={saving}
                disabled={!hasLicense && !licensePhoto}
                variant="accent"
                icon={Car}
              />
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.primary },
  header: { alignItems: 'center', backgroundColor: colors.primary },
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
  photoSection: { gap: 12 },
  photoLabel: { fontFamily: fonts.medium, fontSize: 14, color: colors.primary },
  photo: {
    width: '100%',
    height: 190,
    backgroundColor: colors.inputBg,
    borderRadius: radius,
  },
  description: {
    fontFamily: fonts.regular,
    fontSize: 14,
    lineHeight: 21,
    color: colors.muted,
  },
});
