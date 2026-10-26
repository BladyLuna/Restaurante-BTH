/**
 * Sistema visual compartido de la app (React Native + react-native-web).
 *
 * No hay CSS aqui: todo es StyleSheet de React Native. Las sombras se declaran
 * con elevation (Android) + shadowColor/shadowOffset/shadowOpacity/shadowRadius
 * (iOS y web), nunca con strings tipo box-shadow.
 *
 * TEMA CLARO / OSCURO
 * Los estilos NO son constantes de modulo: se construyen por paleta con
 * crearEstilos() y se cachean (solo hay dos temas). Los componentes leen la
 * paleta activa con useUi(). Un StyleSheet creado al importar el modulo
 * congelaria los colores del primer render y el cambio de tema no se veria.
 *
 * Reglas duras que este archivo sostiene:
 *  - Ningun control tactil baja de 64x64 px (tablet/celular usado con las manos ocupadas).
 *  - Los botones tienen jerarquia real: primary / secondary / danger / chip / ghost,
 *    y el estado disabled se distingue por color, no solo por opacidad.
 *  - Espaciado base 8 px, radios 8 / 20 / 32 / 999.
 *  - Contraste WCAG AA en ambos temas (verificado en tests/theme.test.ts).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {Link} from 'expo-router';
import {apiUrl} from '../api/session';
import {useBranding} from '../api/branding';
import {
  CLAVE_TEMA,
  PREFERENCIA_POR_DEFECTO,
  normalizarTema,
  paletaDe,
  temaEfectivo,
  type Modo,
  type Paleta,
  type Preferencia,
} from './theme';

export type {Modo, Paleta, Preferencia} from './theme';

/* ------------------------------------------------------------------ marca */

export const brand = {name: 'Mesa', tagline: 'restaurante'};

/* ----------------------------------------------------------------- tokens */

export const space = {xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48} as const;

export const radius = {
  button: 8,
  field: 12,
  card: 20,
  container: 32,
  pill: 999,
} as const;

const BG_OSCURO = paletaDe('oscuro').bg;

/** Tres capas suaves. En oscuro se sube la opacidad: una sombra tenue no se ve. */
export function sombra(level: 1 | 2 | 3, paleta: Paleta): ViewStyle {
  const base = {
    1: {elevation: 1, shadowOpacity: 0.04, shadowRadius: 10, offsetY: 2},
    2: {elevation: 2, shadowOpacity: 0.07, shadowRadius: 18, offsetY: 6},
    3: {elevation: 3, shadowOpacity: 0.1, shadowRadius: 28, offsetY: 12},
  }[level];
  const esOscuro = paleta.bg === BG_OSCURO;
  return {
    elevation: base.elevation,
    shadowColor: paleta.shadowColor,
    shadowOffset: {width: 0, height: base.offsetY},
    shadowOpacity: esOscuro ? base.shadowOpacity * 3.5 : base.shadowOpacity,
    shadowRadius: base.shadowRadius,
  };
}

/* ------------------------------------------------------- estilos por tema */

function crearTipos(c: Paleta) {
  return StyleSheet.create({
    display: {fontSize: 40, lineHeight: 46, fontWeight: '700', color: c.ink, letterSpacing: -0.6},
    title: {fontSize: 30, lineHeight: 36, fontWeight: '700', color: c.ink, letterSpacing: -0.3},
    subtitle: {fontSize: 22, lineHeight: 28, fontWeight: '600', color: c.ink, letterSpacing: -0.2},
    body: {fontSize: 18, lineHeight: 27, fontWeight: '400', color: c.inkSoft},
    bodyStrong: {fontSize: 18, lineHeight: 27, fontWeight: '600', color: c.ink},
    caption: {fontSize: 15, lineHeight: 22, fontWeight: '500', color: c.muted},
    badge: {fontSize: 13, lineHeight: 16, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase'},
  });
}

function crearEstilos(c: Paleta) {
  const t = crearTipos(c);
  return StyleSheet.create({
    page: {flex: 1, backgroundColor: c.bg},
    wrap: {
      width: '100%',
      maxWidth: 1200,
      alignSelf: 'center',
      padding: space.lg,
      gap: space.lg,
      paddingBottom: space.xxl,
    },
    row: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.md},
    grid: {flexDirection: 'row', flexWrap: 'wrap', gap: space.md},

    // tarjeta: radio generoso, borde tenue y una sola capa de sombra suave
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.card,
      padding: space.lg,
      gap: space.md,
      borderWidth: 1,
      borderColor: c.line,
      ...sombra(1, c),
    },
    cardRaised: {
      backgroundColor: c.surface,
      borderRadius: radius.container,
      padding: space.lg,
      gap: space.md,
      borderWidth: 1,
      borderColor: c.line,
      ...sombra(2, c),
    },
    cardSelected: {borderColor: c.accent, borderWidth: 2, backgroundColor: c.cardSelectedBg},

    // texto (nombres heredados que los consumidores ya usan)
    title: t.title,
    display: t.display,
    subtitle: t.subtitle,
    text: t.body,
    textStrong: t.bodyStrong,
    muted: t.caption,
    price: {fontSize: 26, lineHeight: 32, fontWeight: '700', color: c.accent, letterSpacing: -0.3},
    priceBig: {fontSize: 34, lineHeight: 40, fontWeight: '700', color: c.accent, letterSpacing: -0.5},

    // base de boton: 72 de alto minimo, nunca menos
    button: {
      minHeight: 72,
      minWidth: 72,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      borderRadius: radius.button,
      backgroundColor: c.accent,
      borderWidth: 1,
      borderColor: c.accent,
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: space.sm,
    },
    buttonText: {fontSize: 18, lineHeight: 24, fontWeight: '600', color: c.onAccent, textAlign: 'center'},

    input: {
      minHeight: 64,
      fontSize: 18,
      lineHeight: 24,
      borderWidth: 1,
      borderColor: c.lineStrong,
      borderRadius: radius.field,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      backgroundColor: c.surface,
      color: c.ink,
    },
    inputFocused: {borderColor: c.accent, borderWidth: 2, backgroundColor: c.inputFocusedBg},
    inputError: {borderColor: c.danger, borderWidth: 2},

    notice: {
      paddingHorizontal: space.md,
      paddingVertical: space.md,
      borderRadius: radius.field,
      backgroundColor: c.warnSoft,
      borderLeftWidth: 4,
      borderLeftColor: c.warn,
      gap: space.xs,
    },

    overlay: {flex: 1, backgroundColor: 'rgba(12,8,4,0.66)', justifyContent: 'center', padding: space.lg},

    divider: {height: 1, backgroundColor: c.line, width: '100%'},

    // header del Page
    header: {flexDirection: 'row', alignItems: 'center', gap: space.md, flexWrap: 'wrap'},
    logoCircle: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    logoLetter: {fontSize: 24, lineHeight: 28, fontWeight: '700', color: c.accentDeep},
    homeLink: {
      minHeight: 64,
      minWidth: 112,
      paddingHorizontal: space.lg,
      paddingVertical: 20,
      borderRadius: radius.button,
      borderWidth: 1,
      borderColor: c.lineStrong,
      backgroundColor: c.surface,
      color: c.ink,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },

    badge: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: c.bgAlt,
      borderWidth: 1,
      borderColor: c.line,
    },

    empty: {
      alignItems: 'center',
      gap: space.sm,
      paddingVertical: space.xl,
      paddingHorizontal: space.lg,
      borderRadius: radius.container,
      backgroundColor: c.bgAlt,
      borderWidth: 1,
      borderColor: c.line,
      borderStyle: 'dashed',
    },
    emptyMark: {
      width: 72,
      height: 72,
      borderRadius: radius.pill,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.sm,
    },

    media: {width: '100%', backgroundColor: c.bgAlt, borderRadius: radius.field},
    mediaBox: {
      width: '100%',
      borderRadius: radius.field,
      backgroundColor: c.bgAlt,
      overflow: 'hidden',
      justifyContent: 'center',
      alignItems: 'center',
    },

    loadingBar: {flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 32},
  });
}

export type Estilos = ReturnType<typeof crearEstilos>;
export type Tipos = ReturnType<typeof crearTipos>;

// Solo hay dos temas: se construyen una vez y se reutilizan.
const CACHE: Record<Modo, {colors: Paleta; s: Estilos; type: Tipos}> = {
  claro: {colors: paletaDe('claro'), s: crearEstilos(paletaDe('claro')), type: crearTipos(paletaDe('claro'))},
  oscuro: {colors: paletaDe('oscuro'), s: crearEstilos(paletaDe('oscuro')), type: crearTipos(paletaDe('oscuro'))},
};

/* --------------------------------------------------------------- contexto */

type Ui = {
  colors: Paleta;
  s: Estilos;
  type: Tipos;
  modo: Modo;
  preferencia: Preferencia;
  /** 'claro' | 'oscuro' | 'sistema'. Se guarda en el dispositivo. */
  setPreferencia: (p: Preferencia) => void;
};

const UiContext = createContext<Ui | null>(null);

// AsyncStorage arrastra react-native: carga perezosa para no romper los tests.
async function storage() {
  const mod = await import('@react-native-async-storage/async-storage');
  return mod.default;
}

export function UiProvider({children}: {children: React.ReactNode}) {
  const esquema = useColorScheme();
  const [preferencia, setPref] = useState<Preferencia>(PREFERENCIA_POR_DEFECTO);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const guardado = normalizarTema(await (await storage()).getItem(CLAVE_TEMA));
        if (vivo && guardado) setPref(guardado);
      } catch {
        // sin persistencia: queda la preferencia por defecto
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const setPreferencia = useCallback((p: Preferencia) => {
    setPref(p);
    void (async () => {
      try {
        await (await storage()).setItem(CLAVE_TEMA, p);
      } catch {
        // se mantiene en memoria para esta sesion
      }
    })();
  }, []);

  const modo = temaEfectivo(preferencia, esquema);
  const valor = useMemo<Ui>(
    () => ({...CACHE[modo], modo, preferencia, setPreferencia}),
    [modo, preferencia, setPreferencia],
  );

  return <UiContext.Provider value={valor}>{children}</UiContext.Provider>;
}

/** Paleta y estilos del tema activo. Fuera del provider cae a claro. */
export function useUi(): Ui {
  const ctx = useContext(UiContext);
  if (ctx) return ctx;
  return {...CACHE.claro, modo: 'claro', preferencia: 'sistema', setPreferencia: () => {}};
}

/**
 * Compatibilidad: tema claro como constantes de modulo.
 * Solo para codigo que no puede usar hooks. Lo que se renderiza debe usar
 * useUi(), si no el cambio de tema no lo alcanza.
 */
export const colors = CACHE.claro.colors;
export const s = CACHE.claro.s;
export const type = CACHE.claro.type;
export const shadow = (level: 1 | 2 | 3) => sombra(level, CACHE.claro.colors);

/* --------------------------------------------------------------- Button */

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'chip' | 'ghost';

function variantesDe(c: Paleta): Record<ButtonVariant, {view: ViewStyle; text: {color: string}}> {
  return {
    // accion principal: unico uso del acento lleno
    primary: {view: {backgroundColor: c.accent, borderColor: c.accent, ...sombra(1, c)}, text: {color: c.onAccent}},
    // accion alterna: contorno, sin peso visual
    secondary: {view: {backgroundColor: c.surface, borderColor: c.lineStrong}, text: {color: c.ink}},
    // dinero / irreversible: color propio, borde grueso y mas alto que el resto
    danger: {
      view: {backgroundColor: c.danger, borderColor: c.danger, borderWidth: 2, ...sombra(2, c)},
      text: {color: c.onDanger},
    },
    // filtro / toggle
    chip: {view: {backgroundColor: c.bgAlt, borderColor: c.line}, text: {color: c.inkSoft}},
    // terciario, casi texto
    ghost: {view: {backgroundColor: 'transparent', borderColor: 'transparent'}, text: {color: c.accentDeep}},
  };
}

export function Button({
  title,
  onPress,
  disabled = false,
  secondary = false,
  variant,
  loading = false,
  selected = false,
  round = false,
  grow = false,
  accessibilityLabel,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** Compatibilidad: equivale a variant="secondary". */
  secondary?: boolean;
  variant?: ButtonVariant;
  /** Muestra spinner y bloquea el toque sin cambiar el texto del boton. */
  loading?: boolean;
  /** Para chips/toggles: marca el estado activo con el acento. */
  selected?: boolean;
  /** Control circular de 72x72 (ej. + / − de cantidad). */
  round?: boolean;
  grow?: boolean;
  accessibilityLabel?: string;
}) {
  const {colors: c, s: st} = useUi();
  const kind: ButtonVariant = variant ?? (secondary ? 'secondary' : 'primary');
  const v = variantesDe(c)[kind];
  const blocked = disabled || loading;
  const activeChip = selected && (kind === 'chip' || kind === 'secondary');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{disabled: blocked, busy: loading, selected}}
      disabled={blocked}
      onPress={onPress}
      style={({pressed}) => [
        st.button,
        v.view,
        round && {width: 72, height: 72, borderRadius: radius.pill, paddingHorizontal: 0},
        grow && {flexGrow: 1, flexBasis: 180},
        kind === 'danger' && {minHeight: 80},
        activeChip && {backgroundColor: c.accentSoft, borderColor: c.accent, borderWidth: 2},
        // disabled tiene color propio: se lee distinto, no solo mas tenue
        blocked && {
          backgroundColor: kind === 'ghost' ? 'transparent' : c.disabledBg,
          borderColor: c.disabledBg,
          borderWidth: 1,
          elevation: 0,
          shadowOpacity: 0,
        },
        pressed && !blocked && {transform: [{scale: 0.985}], opacity: 0.92},
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={blocked ? c.disabledInk : v.text.color} /> : null}
      <Text
        style={[
          st.buttonText,
          v.text,
          activeChip && {color: c.accentDeep, fontWeight: '700'},
          blocked && {color: c.disabledInk},
          round && {fontSize: 26, lineHeight: 30, fontWeight: '700'},
        ]}
        numberOfLines={round ? 1 : 2}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- Field */

export function Field({
  label,
  hint,
  error,
  ...props
}: TextInputProps & {label: string; hint?: string; error?: string}) {
  const {colors: c, s: st, type: t} = useUi();
  const [focused, setFocused] = useState(false);
  const editable = props.editable !== false;
  return (
    <View style={{gap: space.sm}}>
      <Text style={t.bodyStrong}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.faint}
        {...props}
        onFocus={e => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={e => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        style={[
          st.input,
          focused && st.inputFocused,
          !!error && st.inputError,
          !editable && {backgroundColor: c.disabledBg, color: c.disabledInk, borderColor: c.line},
          props.style,
        ]}
      />
      {error ? (
        <Text style={[t.caption, {color: c.danger, fontWeight: '600'}]}>{error}</Text>
      ) : hint ? (
        <Text style={t.caption}>{hint}</Text>
      ) : null}
    </View>
  );
}

/* --------------------------------------------------------------- Notice */

export type NoticeTone = 'warn' | 'info' | 'error' | 'success';

function tonosDe(c: Paleta): Record<NoticeTone, {bg: string; bar: string; ink: string; mark: string}> {
  return {
    warn: {bg: c.warnSoft, bar: c.warn, ink: c.noticeWarnInk, mark: '!'},
    info: {bg: c.infoSoft, bar: c.info, ink: c.noticeInfoInk, mark: 'i'},
    error: {bg: c.dangerSoft, bar: c.danger, ink: c.noticeErrorInk, mark: '!'},
    success: {bg: c.successSoft, bar: c.success, ink: c.noticeSuccessInk, mark: '✓'},
  };
}

export function Notice({text, tone = 'warn', title}: {text?: string; tone?: NoticeTone; title?: string}) {
  const {colors: c, s: st, type: t} = useUi();
  if (!text) return null;
  const tn = tonosDe(c)[tone];
  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[st.notice, {backgroundColor: tn.bg, borderLeftColor: tn.bar}]}
    >
      {title ? <Text style={[t.badge, {color: tn.bar}]}>{title}</Text> : null}
      <Text style={[t.body, {color: tn.ink}]}>
        <Text style={{fontWeight: '700'}}>{tn.mark} </Text>
        {text}
      </Text>
    </View>
  );
}

/* ---------------------------------------------------------------- Badge */

export function Badge({text, tone = 'info'}: {text: string; tone?: NoticeTone | 'neutral'}) {
  const {colors: c, s: st, type: t} = useUi();
  const tn = tone === 'neutral' ? {bg: c.bgAlt, bar: c.muted} : tonosDe(c)[tone];
  return (
    <View style={[st.badge, {backgroundColor: tn.bg, borderColor: tn.bar}]}>
      <Text style={[t.badge, {color: tn.bar}]}>{text}</Text>
    </View>
  );
}

/* ----------------------------------------------------------- EmptyState */

export function EmptyState({
  title,
  text,
  mark = '◍',
  action,
}: {
  title: string;
  text?: string;
  mark?: string;
  action?: React.ReactNode;
}) {
  const {colors: c, s: st, type: t} = useUi();
  return (
    <View style={st.empty}>
      <View style={st.emptyMark}>
        <Text style={{fontSize: 30, lineHeight: 34, color: c.accent}}>{mark}</Text>
      </View>
      <Text style={[t.subtitle, {textAlign: 'center'}]}>{title}</Text>
      {text ? <Text style={[t.caption, {textAlign: 'center', maxWidth: 420}]}>{text}</Text> : null}
      {action ? <View style={{marginTop: space.sm}}>{action}</View> : null}
    </View>
  );
}

/* -------------------------------------------------------------- Loading */

/** Carga visible e inline: spinner + etiqueta, para no depender del texto de un boton. */
export function Loading({text = 'Cargando…', visible = true}: {text?: string; visible?: boolean}) {
  const {colors: c, s: st, type: t} = useUi();
  if (!visible) return null;
  return (
    <View accessibilityLiveRegion="polite" style={st.loadingBar}>
      <ActivityIndicator size="small" color={c.accent} />
      <Text style={t.caption}>{text}</Text>
    </View>
  );
}

/** Placeholder de tarjeta mientras llega la primera respuesta. */
export function SkeletonCard({lines = 3}: {lines?: number}) {
  const {colors: c, s: st} = useUi();
  return (
    <View style={[st.card, {flexGrow: 1, flexBasis: 280}]}>
      <View style={{height: 20, width: '45%', borderRadius: radius.button, backgroundColor: c.skeleton}} />
      {Array.from({length: lines}).map((_, i) => (
        <View
          key={i}
          style={{height: 14, width: `${90 - i * 18}%`, borderRadius: radius.button, backgroundColor: c.skeleton}}
        />
      ))}
    </View>
  );
}

/* ------------------------------------------------------------ ThemeToggle */

/**
 * Control de apariencia de la barra superior. Un solo boton circular que alterna
 * claro <-> oscuro; no ocupa espacio de contenido ni compite con las acciones
 * de la pantalla. El icono muestra el tema al que se va a cambiar, no el actual.
 */
export function ThemeToggle() {
  const {modo, setPreferencia, colors: c} = useUi();
  const vaAOscuro = modo === 'claro';
  const etiqueta = vaAOscuro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={etiqueta}
      accessibilityState={{checked: modo === 'oscuro'}}
      onPress={() => setPreferencia(vaAOscuro ? 'oscuro' : 'claro')}
      style={({pressed}) => [
        {
          width: 64,
          height: 64,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: c.lineStrong,
          backgroundColor: c.surface,
          alignItems: 'center',
          justifyContent: 'center',
        },
        pressed && {backgroundColor: c.bgAlt, transform: [{scale: 0.96}]},
      ]}
    >
      <Text style={{fontSize: 22, lineHeight: 26, color: c.inkSoft}}>{vaAOscuro ? '☾' : '☀'}</Text>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- Page */

function Logo({logoUrl, nombre}: {logoUrl?: string | null; nombre?: string}) {
  const {s: st} = useUi();
  const [failed, setFailed] = useState(false);
  const etiqueta = nombre || brand.name;
  const src = logoUrl && !logoUrl.startsWith('data:') && logoUrl.startsWith('/') ? apiUrl() + logoUrl : logoUrl;
  if (src && !failed) {
    return (
      <View style={st.logoCircle}>
        <Image
          accessibilityLabel={`Logo de ${etiqueta}`}
          source={{uri: src}}
          onError={() => setFailed(true)}
          resizeMode="cover"
          style={{width: 56, height: 56}}
        />
      </View>
    );
  }
  // Fallback tipografico: inicial del local en circulo con el acento suave.
  // Tambien se usa si la imagen falla al cargar: un circulo con la inicial se
  // ve intencional, un icono de imagen rota parece un error del sistema.
  return (
    <View style={st.logoCircle}>
      <Text style={st.logoLetter}>{etiqueta.slice(0, 1).toUpperCase()}</Text>
    </View>
  );
}

export function Page({
  title,
  subtitle,
  children,
  logoUrl,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /**
   * Logo a mostrar. Normalmente no hace falta: la cabecera toma el del local
   * desde `useBranding()`. Se pasa solo para previsualizar otro (p. ej. en
   * `/local`, antes de guardar).
   */
  logoUrl?: string | null;
}) {
  const {colors: c, s: st, type: t} = useUi();
  // El nombre y el logo del local, no una constante del design system: la
  // dueña los cambia desde /local y la cabecera tiene que reflejarlo.
  const {branding} = useBranding();
  return (
    <ScrollView style={st.page} contentContainerStyle={st.wrap} keyboardShouldPersistTaps="handled">
      <View style={st.header}>
        <Logo logoUrl={logoUrl ?? branding.logoUrl} nombre={branding.nombreLocal} />
        <View style={{flex: 1, minWidth: 120}}>
          <Text style={[t.subtitle, {letterSpacing: 0}]}>{branding.nombreLocal}</Text>
          <Text style={[t.badge, {color: c.muted}]}>{brand.tagline}</Text>
        </View>
        <ThemeToggle />
        <Link href="/" accessibilityLabel="Ir al inicio" style={st.homeLink}>
          Inicio
        </Link>
      </View>
      <View style={{gap: space.sm}}>
        <Text style={t.display}>{title}</Text>
        {subtitle ? <Text style={[t.body, {color: c.muted, maxWidth: 680}]}>{subtitle}</Text> : null}
      </View>
      {children}
    </ScrollView>
  );
}

/* ---------------------------------------------------------- RemoteImage */

export function RemoteImage({uri, qr = false}: {uri?: string | null; qr?: boolean}) {
  const {colors: c, s: st, type: t} = useUi();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!uri || failed) {
    return qr ? (
      <Notice
        tone="error"
        title="Pago"
        text="QR original no disponible. Pedí al personal el QR estático del local; no pagues a una imagen de ejemplo."
      />
    ) : (
      <View style={[st.mediaBox, {height: 150}]}>
        <Text style={{fontSize: 28, lineHeight: 32, color: c.faint}}>◴</Text>
        <Text style={[t.caption, {textAlign: 'center', paddingHorizontal: space.md}]}>
          Foto no disponible · podés pedir este plato igualmente.
        </Text>
      </View>
    );
  }
  const height = qr ? 300 : 150;
  return (
    <View style={[st.mediaBox, {height}]}>
      {!loaded ? (
        <View style={{position: 'absolute', alignItems: 'center', gap: space.sm}}>
          <ActivityIndicator size="small" color={c.accent} />
          <Text style={t.caption}>{qr ? 'Cargando QR…' : 'Cargando foto…'}</Text>
        </View>
      ) : null}
      <Image
        accessibilityLabel={qr ? 'QR estático original del local' : 'Foto del plato'}
        source={{uri: uri.startsWith('/') ? apiUrl() + uri : uri}}
        onError={() => setFailed(true)}
        onLoadEnd={() => setLoaded(true)}
        resizeMode={qr ? 'contain' : 'cover'}
        style={{height, width: '100%', opacity: loaded ? 1 : 0}}
      />
    </View>
  );
}

/* --------------------------------------------------------------- Dialog */

export function Dialog({
  visible,
  title,
  children,
  onClose,
}: {
  visible: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const {colors: c, s: st, type: t} = useUi();
  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={st.overlay}>
        <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center'}}>
          <View
            accessibilityViewIsModal
            style={[st.cardRaised, {width: '100%', maxWidth: 600, alignSelf: 'center', ...sombra(3, c)}]}
          >
            <Text style={t.title}>{title}</Text>
            <View style={st.divider} />
            {children}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}
