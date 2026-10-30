import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthContext';
import {
  getProfilePolicy,
  updateProfile,
  type Profile,
  type ProfilePolicy,
} from '../services/profileService';
import { colors, fonts } from '../theme';
import { Button } from './Button';
import { Message } from './Message';
import { TagChip } from './TagChip';
import { TextField } from './TextField';

export function ProfileDetailsForm({
  initial,
  onSaved,
  onCancel,
  editing = false,
}: {
  initial: Profile;
  onSaved: (profile: Profile) => void;
  onCancel?: () => void;
  editing?: boolean;
}) {
  const { authApi } = useAuth();
  const [policy, setPolicy] = useState<ProfilePolicy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState({
    fullName: initial.fullName,
    course: initial.course ?? '',
    semester: initial.semester ? String(initial.semester) : '',
    bio: initial.bio ?? '',
    tags: [...initial.tags],
  });
  const [newTag, setNewTag] = useState('');
  const [tagError, setTagError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getProfilePolicy(authApi)
      .then((result) => {
        if (active) setPolicy(result);
      })
      .catch((reason: unknown) => {
        if (active)
          setLoadError(
            reason instanceof Error
              ? reason.message
              : 'Não foi possível carregar o formulário.',
          );
      });
    return () => {
      active = false;
    };
  }, [authApi, attempt]);

  function update(
    key: 'fullName' | 'course' | 'semester' | 'bio',
    value: string,
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  function addTag() {
    const tag = newTag.trim().replace(/\s+/g, ' ').normalize('NFC');
    if (!policy) return;
    if (tag.length < policy.tags.minLength) {
      setTagError(
        `Cada tag deve ter pelo menos ${policy.tags.minLength} caracteres.`,
      );
      return;
    }
    if (
      draft.tags.some(
        (item) =>
          item.normalize('NFKC').toLocaleLowerCase('pt-BR') ===
          tag.normalize('NFKC').toLocaleLowerCase('pt-BR'),
      )
    ) {
      setTagError('Essa tag já foi adicionada.');
      return;
    }
    if (draft.tags.length >= policy.tags.max) {
      setTagError(`Você pode adicionar até ${policy.tags.max} tags.`);
      return;
    }
    setDraft((current) => ({ ...current, tags: [...current.tags, tag] }));
    setNewTag('');
    setTagError(null);
    setError(null);
  }

  async function save() {
    if (saving || !policy) return;
    setSaving(true);
    setError(null);
    try {
      const result = await updateProfile(authApi, {
        ...(editing ? { fullName: draft.fullName } : {}),
        course: draft.course,
        semester: draft.semester ? Number(draft.semester) : NaN,
        bio: draft.bio,
        tags: draft.tags,
      });
      onSaved(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Não foi possível salvar seu perfil.',
      );
      setSaving(false);
    }
  }

  if (loadError)
    return (
      <View style={styles.form}>
        <Message tone="error">{loadError}</Message>
        <Button
          title="Tentar novamente"
          variant="outline"
          onPress={() => {
            setLoadError(null);
            setAttempt((current) => current + 1);
          }}
        />
      </View>
    );
  if (!policy)
    return (
      <ActivityIndicator
        color={colors.accent}
        accessibilityLabel="Carregando formulário"
      />
    );

  return (
    <View style={styles.form}>
      <Text style={styles.hint}>Todos os campos são obrigatórios.</Text>
      {editing ? (
        <TextField
          label="Nome completo"
          value={draft.fullName}
          onChangeText={(value) => update('fullName', value)}
          editable={!saving}
        />
      ) : null}
      <TextField
        label="Curso"
        placeholder="Ex.: Engenharia de Software"
        value={draft.course}
        maxLength={policy.course.maxLength}
        onChangeText={(value) => update('course', value)}
        editable={!saving}
      />
      <TextField
        label="Período atual"
        placeholder="Ex.: 3"
        keyboardType="number-pad"
        value={draft.semester}
        onChangeText={(value) =>
          update(
            'semester',
            value
              .replace(/\D/g, '')
              .slice(0, String(policy.semester.max).length),
          )
        }
        editable={!saving}
      />
      <TextField
        label="Sobre você"
        placeholder="Conte um pouco sobre você e suas preferências nas caronas."
        value={draft.bio}
        onChangeText={(value) => update('bio', value)}
        multiline
        maxLength={policy.bio.maxLength}
        hint={`${draft.bio.length}/${policy.bio.maxLength}`}
        editable={!saving}
      />
      <View style={styles.tagsSection}>
        <Text style={styles.label}>Suas tags</Text>
        <Text style={styles.hint}>
          Adicione pelo menos {policy.tags.min} tags diferentes sobre você.
        </Text>
        <View style={styles.tags}>
          {draft.tags.map((tag) => (
            <TagChip
              key={tag}
              label={tag}
              removable={!saving}
              onRemove={() => {
                setDraft((current) => ({
                  ...current,
                  tags: current.tags.filter((item) => item !== tag),
                }));
                setError(null);
                setTagError(null);
              }}
            />
          ))}
        </View>
        <TextField
          label="Nova tag"
          placeholder="Ex.: Pontual, Música ambiente, Aceita pets"
          value={newTag}
          maxLength={policy.tags.maxLength}
          onChangeText={(value) => {
            setNewTag(value);
            setTagError(null);
          }}
          onSubmitEditing={addTag}
          editable={!saving}
          error={tagError ?? undefined}
        />
        <Button
          title="Adicionar tag"
          variant="outline"
          onPress={addTag}
          disabled={saving || !newTag.trim()}
        />
        <Text style={styles.hint} accessibilityLiveRegion="polite">
          {draft.tags.length}/{policy.tags.min} tags mínimas · máximo{' '}
          {policy.tags.max}
        </Text>
      </View>
      {error ? <Message tone="error">{error}</Message> : null}
      <Button
        title={editing ? 'Salvar alterações' : 'Concluir perfil'}
        variant="accent"
        onPress={() => void save()}
        loading={saving}
        disabled={
          !draft.course.trim() ||
          !draft.semester ||
          !draft.bio.trim() ||
          draft.tags.length < policy.tags.min
        }
      />
      {onCancel ? (
        <Button
          title="Cancelar"
          variant="outline"
          onPress={onCancel}
          disabled={saving}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 20 },
  hint: {
    fontFamily: fonts.regular,
    color: colors.muted,
    fontSize: 13,
    lineHeight: 19,
  },
  label: { fontFamily: fonts.medium, color: colors.primary, fontSize: 14 },
  tagsSection: { gap: 12 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
