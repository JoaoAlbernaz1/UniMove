import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react-native';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, maxContentWidth } from '../theme';

type HelpCategory = 'Conta' | 'Caronas' | 'Segurança' | 'Notificações';

type HelpArticle = {
  category: HelpCategory;
  question: string;
  answer: string;
};

const categories: ('Tudo' | HelpCategory)[] = [
  'Tudo',
  'Conta',
  'Caronas',
  'Segurança',
  'Notificações',
];

const articles: HelpArticle[] = [
  {
    category: 'Conta',
    question: 'Por que preciso completar meu perfil?',
    answer:
      'O perfil acadêmico ajuda a identificar a comunidade UniMove. Complete curso, semestre, biografia e interesses para acessar as funcionalidades do aplicativo.',
  },
  {
    category: 'Conta',
    question: 'Por que minha validação acadêmica está em análise?',
    answer:
      'Após enviar o comprovante de matrícula, a solicitação fica pendente até a revisão. Enquanto isso, algumas funções de caronas podem permanecer indisponíveis.',
  },
  {
    category: 'Caronas',
    question: 'Como encontro uma carona?',
    answer:
      'Abra a busca de caronas e informe origem, destino, data e horário. Confira os detalhes da oferta antes de solicitar uma vaga.',
  },
  {
    category: 'Caronas',
    question: 'O que acontece depois que solicito uma vaga?',
    answer:
      'A solicitação aguarda a resposta do motorista. Você pode acompanhar o status nas áreas de solicitações e histórico do aplicativo.',
  },
  {
    category: 'Segurança',
    question: 'Como ativo a verificação em duas etapas?',
    answer:
      'Em Configurações > Privacidade, inicie a configuração e leia o QR code com um aplicativo autenticador. Digite o código gerado para confirmar a ativação.',
  },
  {
    category: 'Segurança',
    question: 'O que devo fazer em uma emergência?',
    answer:
      'Esta central não substitui serviços de emergência. Em risco imediato, procure um local seguro e acione os serviços oficiais: Polícia Militar (190) ou SAMU (192).',
  },
  {
    category: 'Notificações',
    question: 'Por que não recebo notificações push?',
    answer:
      'Confira se as notificações estão permitidas nas configurações do seu celular e ativadas no UniMove. O registro de push deve ser feito em um dispositivo físico.',
  },
  {
    category: 'Notificações',
    question: 'E-mail e SMS são enviados imediatamente?',
    answer:
      'A entrega por e-mail e SMS depende da configuração dos provedores no ambiente do UniMove e de um endereço ou telefone válido na sua conta.',
  },
];

function HelpCategoryChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.categoryChip, selected && styles.categoryChipSelected]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text
        style={[
          styles.categoryChipText,
          selected && styles.categoryChipTextSelected,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function HelpArticleRow({
  article,
  expanded,
  onPress,
}: {
  article: HelpArticle;
  expanded: boolean;
  onPress: () => void;
}) {
  const ExpandIcon = expanded ? ChevronUp : ChevronDown;

  return (
    <View style={styles.article}>
      <Pressable
        onPress={onPress}
        style={styles.question}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <View style={styles.questionCopy}>
          <Text style={styles.articleCategory}>{article.category}</Text>
          <Text style={styles.questionText}>{article.question}</Text>
        </View>
        <ExpandIcon size={19} color={colors.muted} />
      </Pressable>
      {expanded ? <Text style={styles.answer}>{article.answer}</Text> : null}
    </View>
  );
}

export function HelpCenterScreen({ onBack }: { onBack: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] =
    useState<(typeof categories)[number]>('Tudo');
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);

  const visibleArticles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('pt-BR');
    return articles.filter((article) => {
      const matchesCategory =
        selectedCategory === 'Tudo' || article.category === selectedCategory;
      const matchesQuery =
        !normalizedQuery ||
        `${article.category} ${article.question} ${article.answer}`
          .toLocaleLowerCase('pt-BR')
          .includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [query, selectedCategory]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Pressable
            onPress={onBack}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel="Voltar para Configurações"
          >
            <ArrowLeft size={22} color={colors.white} />
          </Pressable>
          <Text style={styles.headerTitle}>Central de Ajuda</Text>
        </View>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.introCard}>
          <View style={styles.introIcon}>
            <CircleHelp size={22} color={colors.accentDark} />
          </View>
          <Text style={styles.title}>Como podemos ajudar?</Text>
          <Text style={styles.subtitle}>
            Encontre respostas rápidas sobre sua conta e o uso do UniMove.
          </Text>
          <View style={styles.searchBox}>
            <Search size={18} color={colors.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Buscar uma dúvida"
              placeholderTextColor={colors.muted}
              style={styles.searchInput}
              returnKeyType="search"
              accessibilityLabel="Buscar na Central de Ajuda"
            />
            {query ? (
              <Pressable
                onPress={() => setQuery('')}
                accessibilityRole="button"
                accessibilityLabel="Limpar busca"
                hitSlop={8}
              >
                <X size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryList}
          keyboardShouldPersistTaps="handled"
        >
          {categories.map((category) => (
            <HelpCategoryChip
              key={category}
              label={category}
              selected={selectedCategory === category}
              onPress={() => setSelectedCategory(category)}
            />
          ))}
        </ScrollView>

        <Text style={styles.sectionTitle}>PERGUNTAS FREQUENTES</Text>
        <View style={styles.articlesCard}>
          {visibleArticles.length ? (
            visibleArticles.map((article, index) => {
              const isExpanded = expandedQuestion === article.question;
              return (
                <View
                  key={article.question}
                  style={index < visibleArticles.length - 1 && styles.divided}
                >
                  <HelpArticleRow
                    article={article}
                    expanded={isExpanded}
                    onPress={() =>
                      setExpandedQuestion((current) =>
                        current === article.question ? null : article.question,
                      )
                    }
                  />
                </View>
              );
            })
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Nenhum resultado encontrado</Text>
              <Text style={styles.emptyText}>
                Tente buscar com outras palavras ou escolha outra categoria.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.emergencyNote}>
          <ShieldAlert size={19} color={colors.accentDark} />
          <Text style={styles.emergencyText}>
            Em caso de risco imediato, acione os serviços oficiais de emergência.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: { backgroundColor: colors.primary },
  headerContent: {
    width: '100%',
    maxWidth: maxContentWidth,
    minHeight: 56,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  backButton: {
    width: 42,
    height: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerTitle: { fontFamily: fonts.bold, fontSize: 18, color: colors.white },
  body: { flex: 1, backgroundColor: colors.background },
  content: {
    width: '100%',
    maxWidth: maxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  introCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    backgroundColor: colors.white,
    padding: 16,
  },
  introIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentBg,
    marginBottom: 12,
  },
  title: { fontFamily: fonts.bold, fontSize: 20, color: colors.primary },
  subtitle: {
    marginTop: 5,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.muted,
  },
  searchBox: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.inputBg,
    marginTop: 16,
    paddingHorizontal: 12,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    fontFamily: fonts.regular,
    fontSize: 13,
    color: colors.primary,
  },
  categoryList: { gap: 8, paddingVertical: 16 },
  categoryChip: {
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 17,
    backgroundColor: colors.white,
    paddingHorizontal: 13,
  },
  categoryChipSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  categoryChipText: {
    fontFamily: fonts.medium,
    fontSize: 12,
    color: colors.foreground,
  },
  categoryChipTextSelected: { color: colors.accentDark },
  sectionTitle: {
    marginBottom: 8,
    paddingHorizontal: 6,
    fontFamily: fonts.medium,
    fontSize: 10,
    letterSpacing: 0.3,
    color: colors.muted,
  },
  articlesCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: colors.white,
  },
  divided: { borderBottomWidth: 1, borderBottomColor: colors.border },
  article: { paddingHorizontal: 14, paddingVertical: 2 },
  question: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  questionCopy: { flex: 1, gap: 4 },
  articleCategory: {
    fontFamily: fonts.medium,
    fontSize: 10,
    color: colors.accentDark,
  },
  questionText: {
    fontFamily: fonts.medium,
    fontSize: 13,
    lineHeight: 18,
    color: colors.primary,
  },
  answer: {
    paddingRight: 26,
    paddingBottom: 15,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
  },
  emptyState: { paddingHorizontal: 18, paddingVertical: 24, alignItems: 'center' },
  emptyTitle: {
    fontFamily: fonts.medium,
    fontSize: 14,
    color: colors.primary,
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 5,
    fontFamily: fonts.regular,
    fontSize: 12,
    lineHeight: 18,
    color: colors.muted,
    textAlign: 'center',
  },
  emergencyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 12,
    backgroundColor: colors.accentBg,
    marginTop: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  emergencyText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 11,
    lineHeight: 16,
    color: colors.foreground,
  },
});
