/**
 * B10 — Reporte de auditoría (pantalla de la dueña)
 *
 * Fuente: PLAN §5c ("el log existe para poder explicar un cierre que no
 * cuadra"), §5g (solo ADMIN). D-07.
 *
 * Qué resuelve esta pantalla: la dueña pregunta "¿quién cambió este precio?" o
 * "¿quién confirmó este cobro?" y acá está la respuesta, con nombre y hora.
 *
 * Cuatro decisiones de rendimiento, porque el log crece sin techo (cada login
 * fallido escribe una fila) y una pantalla que hoy va bien puede arrastrarse en
 * tres meses:
 *
 *   1. SIN POLLING. El resto de la app usa `usePoll` porque muestra cosas que
 *      cambian solas: pedidos que entran, pagos que se confirman. Un log
 *      histórico no cambia mientras se lee, así que refrescarlo cada 5 s serían
 *      consultas puras de desperdicio contra la tabla que más crece. Se carga
 *      al entrar y hay un botón para volver a pedirlo.
 *
 *   2. PAGINACIÓN POR CURSOR, acumulando páginas en memoria. "Ver más" agrega
 *      25 filas a las que ya están; nunca se vuelve a pedir lo mismo.
 *
 *   3. LOS CONTADORES NO VUELVEN A PEDIRSE al cambiar de pestaña. Vienen del
 *      `groupBy` de la primera carga y describen el rango completo, que no
 *      depende del grupo elegido.
 *
 *   4. FILTRO DE PESTAÑA SIN RED cuando ya se cargó "Todo": si las entradas de
 *      la primera página alcanzan, se filtran en memoria. Solo se consulta al
 *      servidor cuando hace falta traer más.
 *
 * Y una visual: cada entrada se pinta con una barra de color según el grupo
 * (dinero / carta / accesos). El ojo encuentra "qué pasó con la plata" sin
 * leer, que es justo lo que se busca cuando un cierre no cuadra.
 */

import {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, Pressable} from 'react-native';
import {
  AUDITORIA_POR_PAGINA,
  type EntradaAuditoriaDto,
  type GrupoAuditoria,
  type ReporteAuditoriaDto,
} from '@restaurante/shared';
import {useSession} from '../shared/api/session';
import {errorMessage} from '../shared/api/errors';
import {
  Page,
  Button,
  Notice,
  Badge,
  EmptyState,
  SkeletonCard,
  useUi,
  space,
  radius,
} from '../shared/ui';

/** Las pestañas, en el orden en que le importan a la dueña. */
const PESTANAS: {grupo: GrupoAuditoria; titulo: string; nota: string}[] = [
  {grupo: 'TODO', titulo: 'Todo', nota: 'Cada movimiento registrado'},
  {grupo: 'DINERO', titulo: 'Dinero', nota: 'Cobros, cancelaciones, devoluciones y QR'},
  {grupo: 'CARTA', titulo: 'Carta', nota: 'Precios y platos que entran o salen'},
  {grupo: 'ACCESOS', titulo: 'Accesos', nota: 'Usuarios, permisos e intentos de entrada'},
];

const RANGOS = [
  {dias: 1, titulo: 'Hoy'},
  {dias: 7, titulo: '7 días'},
  {dias: 30, titulo: '30 días'},
  {dias: 90, titulo: '90 días'},
];

/** Color de la barra lateral por grupo. Es la señal visual de la lista. */
function tonoDe(grupo: GrupoAuditoria): 'error' | 'warn' | 'info' | 'neutral' {
  if (grupo === 'DINERO') return 'error';
  if (grupo === 'CARTA') return 'warn';
  if (grupo === 'ACCESOS') return 'info';
  return 'neutral';
}

/**
 * Fecha legible. Las de hoy muestran solo la hora: en un log que se lee para
 * resolver algo que acaba de pasar, repetir la fecha de hoy en 25 filas es
 * ruido.
 */
function cuando(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia =
    d.getDate() === hoy.getDate() &&
    d.getMonth() === hoy.getMonth() &&
    d.getFullYear() === hoy.getFullYear();
  const hora = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  if (mismoDia) return `Hoy ${hora}`;
  return `${d.toLocaleDateString([], {day: '2-digit', month: 'short'})} ${hora}`;
}

function money(centavos: number | null): string {
  if (centavos === null) return '—';
  return `Bs ${Math.round(centavos / 100)}`;
}

export default function Auditoria() {
  const {s, colors: c, type: t} = useUi();
  const {call, user} = useSession();

  const [grupo, setGrupo] = useState<GrupoAuditoria>('TODO');
  const [dias, setDias] = useState(7);
  const [entradas, setEntradas] = useState<EntradaAuditoriaDto[]>([]);
  const [totales, setTotales] = useState<ReporteAuditoriaDto['totales'] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [trayendoMas, setTrayendoMas] = useState(false);
  const [actualizado, setActualizado] = useState('');

  /**
   * Carga una página. `reinicia` distingue "entré o cambié de filtro" de
   * "pedí ver más": en el primer caso se reemplaza la lista, en el segundo se
   * acumula.
   */
  const cargar = useCallback(
    async (reinicia: boolean, desdeCursor?: string | null) => {
      reinicia ? setCargando(true) : setTrayendoMas(true);
      setError('');
      try {
        const qs = new URLSearchParams({grupo, dias: String(dias)});
        if (desdeCursor) qs.set('cursor', desdeCursor);
        const r = await call<ReporteAuditoriaDto>(`/admin/audit?${qs}`);
        setEntradas((previas) => (reinicia ? r.entradas : [...previas, ...r.entradas]));
        setCursor(r.siguienteCursor);
        // Los contadores describen el rango, no el grupo: solo se refrescan
        // cuando la consulta empieza de cero.
        if (reinicia) setTotales(r.totales);
        setActualizado(new Date().toLocaleTimeString());
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        reinicia ? setCargando(false) : setTrayendoMas(false);
      }
    },
    [call, grupo, dias],
  );

  // Una carga al entrar y una por cambio de filtro. Sin intervalos.
  useEffect(() => {
    void cargar(true);
  }, [cargar]);

  /** Filtrado en memoria: evita un viaje a la red en el caso más común. */
  const visibles = useMemo(
    () => (grupo === 'TODO' ? entradas : entradas.filter((e) => e.grupo === grupo)),
    [entradas, grupo],
  );

  if (user?.rol !== 'ADMIN') {
    return (
      <Page title="Registro de actividad" subtitle="Quién hizo qué, y cuándo.">
        <Notice
          tone="info"
          title="Solo la dueña"
          text="Este registro existe para supervisar cobros y cambios de precio, así que no lo abre quien los ejecuta. Si necesitás revisar un movimiento, pedíselo a la dueña."
        />
      </Page>
    );
  }

  const pestanaActual = PESTANAS.find((p) => p.grupo === grupo);

  return (
    <Page title="Registro de actividad" subtitle="Quién hizo qué, y cuándo. Para explicar un cierre que no cuadra.">
      <Notice tone="error" text={error} />

      {/* Rango temporal. Obligatorio: sin ventana, la consulta escanearía todo. */}
      <View style={s.row}>
        {RANGOS.map((r) => (
          <Button
            key={r.dias}
            variant="chip"
            title={r.titulo}
            selected={dias === r.dias}
            onPress={() => setDias(r.dias)}
          />
        ))}
      </View>

      {/* Pestañas con contador. El número sale del groupBy, no de contar filas. */}
      <View style={[s.row, {gap: space.sm}]}>
        {PESTANAS.map((p) => {
          const activa = grupo === p.grupo;
          const n = totales?.[p.grupo];
          return (
            <Pressable
              key={p.grupo}
              onPress={() => setGrupo(p.grupo)}
              accessibilityRole="tab"
              accessibilityState={{selected: activa}}
              style={{
                flexGrow: 1,
                flexBasis: 120,
                paddingVertical: space.md,
                paddingHorizontal: space.md,
                borderRadius: radius.card,
                borderWidth: 1,
                borderColor: activa ? c.accent : c.line,
                backgroundColor: activa ? c.cardSelectedBg : c.surface,
                gap: 2,
              }}>
              <Text style={[t.caption, {color: activa ? c.accentDeep : c.muted}]}>
                {p.titulo}
              </Text>
              <Text style={[t.title, {color: activa ? c.accentDeep : c.ink}]}>
                {n ?? '—'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {pestanaActual && <Text style={s.muted}>{pestanaActual.nota}</Text>}

      <View style={s.row}>
        <Button
          title="Actualizar"
          secondary
          loading={cargando}
          onPress={() => void cargar(true)}
        />
        <Text style={s.muted}>
          {actualizado ? `Consultado a las ${actualizado}` : 'Consultando…'}
          {' · se pide solo cuando lo pedís'}
        </Text>
      </View>

      {cargando && (
        <>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </>
      )}

      {!cargando && visibles.length === 0 && (
        <EmptyState
          mark="✓"
          title="No hay movimientos en este rango"
          text="Nada que explicar: en el período elegido no se registraron cambios de este tipo. Probá ampliar los días."
          action={
            <Button title="Ver 30 días" secondary onPress={() => setDias(30)} />
          }
        />
      )}

      {!cargando &&
        visibles.map((e) => (
          <View
            key={e.id}
            style={[
              s.card,
              {
                // La barra de color es la señal que se lee sin leer.
                borderLeftWidth: 4,
                borderLeftColor:
                  e.grupo === 'DINERO'
                    ? c.danger
                    : e.grupo === 'CARTA'
                      ? c.warn
                      : e.grupo === 'ACCESOS'
                        ? c.info
                        : c.line,
                gap: space.sm,
              },
            ]}>
            <View style={s.row}>
              <Badge tone={tonoDe(e.grupo)} text={e.grupo} />
              <Text style={[s.muted, {flex: 1, minWidth: 90, textAlign: 'right'}]}>
                {cuando(e.creadoEn)}
              </Text>
            </View>

            <Text style={s.textStrong}>{e.resumen}</Text>

            <View style={s.row}>
              {/* Sin autor = lo hizo el sistema. Hay que distinguirlo de una
                  persona: "expiró a los 15 min" no es responsabilidad de nadie. */}
              <Text style={s.muted}>
                {e.autor
                  ? `${e.autor}${e.rolAutor ? ` · ${e.rolAutor}` : ''}`
                  : 'El sistema, sin intervención de nadie'}
              </Text>
              {e.numeroPedido !== null && (
                <Badge tone="neutral" text={`Pedido #${e.numeroPedido}`} />
              )}
            </View>

            {/* El detalle de montos solo aparece cuando hubo diferencia: es el
                caso que la dueña necesita ver completo (D-11). */}
            {e.montoEsperado !== null && e.montoRecibido !== null && (
              <View style={[s.row, {gap: space.md}]}>
                <Text style={s.muted}>Esperaba {money(e.montoEsperado)}</Text>
                <Text
                  style={[
                    s.textStrong,
                    {
                      color:
                        e.montoRecibido < e.montoEsperado ? c.danger : c.success,
                    },
                  ]}>
                  Entró {money(e.montoRecibido)}
                </Text>
              </View>
            )}
          </View>
        ))}

      {/* "Ver más" solo si el servidor dijo que hay más. */}
      {!cargando && cursor && (
        <Button
          title={trayendoMas ? 'Trayendo…' : `Ver ${AUDITORIA_POR_PAGINA} más`}
          secondary
          loading={trayendoMas}
          onPress={() => void cargar(false, cursor)}
        />
      )}

      {!cargando && !cursor && visibles.length > 0 && (
        <Text style={[s.muted, {textAlign: 'center'}]}>
          Fin del registro para este rango.
        </Text>
      )}
    </Page>
  );
}
