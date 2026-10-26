/**
 * F5 — Gestión de la carta (pantalla de la dueña)
 *
 * Fuente: PLAN §4 (modelo), §5g (solo ADMIN), §616 ("precio editable en la
 * misma fila"); D-04 (bolivianos enteros); RQ-201 a RQ-205.
 *
 * Esta pantalla es la mitad del valor del sistema: sin ella la dueña depende
 * de alguien que sepa escribir SQL para subir un precio.
 *
 * Las cuatro reglas del catálogo, tal como se ven acá:
 *
 *   1. NUNCA SE BORRA (RQ-204). No hay botón de eliminar en ningún lugar de
 *      esta pantalla, y no es un olvido: un plato borrado dejaría OrderItem
 *      huérfanos y corrompería los reportes históricos. Lo que hay es
 *      "Dejar de ofrecer", que es además la acción más frecuente del día
 *      ("se acabó el pollo") y por eso está a un toque, sin confirmación.
 *
 *   2. UN CAMBIO DE PRECIO ES UN EVENTO FINANCIERO (RQ-209, D-07). El panel
 *      lo dice explícitamente al editar, porque la dueña tiene que saber que
 *      queda registrado con su nombre. El servidor lo audita dentro de la
 *      misma transacción.
 *
 *   3. DESACTIVAR UNA CATEGORÍA CASCADEA a sus platos. La UI avisa antes,
 *      porque es la única acción de esta pantalla con efecto en masa.
 *
 *   4. EL PANEL VE LOS INACTIVOS, el kiosco no. Un plato apagado se muestra
 *      atenuado y con su etiqueta, para poder reactivarlo mañana.
 *
 * Rendimiento: una sola carga de `/admin/catalog` al entrar, sin polling —
 * la carta la edita una persona sola, no cambia por detrás mientras la mira.
 * Después de cada cambio se refresca el árbol completo en vez de parchear el
 * estado local: la respuesta del servidor es la verdad, y así nunca se ve un
 * precio en pantalla que no sea el que quedó guardado.
 */

import {useCallback, useEffect, useState} from 'react';
import {View, Text} from 'react-native';
import {router} from 'expo-router';
import {CatalogSchemas, FOTO_MAX_BYTES} from '@restaurante/shared';
import {useSession} from '../shared/api/session';
import {errorMessage} from '../shared/api/errors';
import {elegirImagen} from '../shared/api/imagen';
import {
  Page,
  Button,
  Field,
  Notice,
  Badge,
  EmptyState,
  SkeletonCard,
  RemoteImage,
  Dialog,
  useUi,
  space,
} from '../shared/ui';

type Variante = {
  id: string;
  nombre: string;
  precioCentavos: number;
  activo: boolean;
  orden: number;
};

type Producto = {
  id: string;
  categoryId: string;
  nombre: string;
  descripcion: string | null;
  precioCentavos: number;
  imagenUrl: string | null;
  activo: boolean;
  orden: number;
  tieneVariantes: boolean;
  variantes: Variante[];
};

type Categoria = {
  id: string;
  nombre: string;
  orden: number;
  activo: boolean;
  productos: Producto[];
};

function money(centavos: number): string {
  return `Bs ${Math.round(centavos / 100)}`;
}

export default function Carta() {
  const {s, colors: c} = useUi();
  const {call, user} = useSession();

  const [arbol, setArbol] = useState<Categoria[] | null>(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState('');

  // Edición de precio: solo una fila abierta a la vez. Un panel con diez
  // inputs abiertos invita a perder un cambio sin guardar.
  const [editando, setEditando] = useState<string | null>(null);
  const [precioTexto, setPrecioTexto] = useState('');

  // Alta de plato, por categoría.
  const [creandoEn, setCreandoEn] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevoPrecio, setNuevoPrecio] = useState('');

  const [nuevaCategoria, setNuevaCategoria] = useState('');
  const [porApagar, setPorApagar] = useState<Categoria | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setArbol(await call<Categoria[]>('/admin/catalog'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCargando(false);
    }
  }, [call]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /**
   * Toda mutación pasa por acá: marca ocupado, ejecuta, recarga el árbol.
   *
   * Recargar en vez de parchear el estado local es deliberado. El servidor
   * puede haber hecho más de lo pedido —apagar una categoría apaga sus
   * platos— y un parche optimista mostraría un árbol que no existe en la base.
   */
  async function mutar(clave: string, fn: () => Promise<unknown>, exito: string) {
    if (ocupado) return;
    setOcupado(clave);
    setError('');
    setAviso('');
    try {
      await fn();
      await cargar();
      setAviso(exito);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOcupado('');
    }
  }

  function guardarPrecio(p: Producto) {
    const bolivianos = Number(precioTexto.trim());
    // Se valida con el MISMO schema que usa el servidor: si divergieran, el
    // panel dejaría pasar algo que la API rechaza con un error que la UI no
    // sabe mostrar (PLAN §6).
    const r = CatalogSchemas.PrecioBolivianos.safeParse(bolivianos);
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Precio inválido');
      return;
    }
    if (bolivianos * 100 === p.precioCentavos) {
      setEditando(null);
      setAviso('El precio no cambió.');
      return;
    }
    void mutar(
      `precio-${p.id}`,
      async () => {
        await call(`/admin/products/${p.id}`, 'PUT', {precioBolivianos: bolivianos});
        setEditando(null);
      },
      `"${p.nombre}" pasó a ${money(bolivianos * 100)}. Quedó registrado en el historial con tu nombre.`,
    );
  }

  function crearProducto(cat: Categoria) {
    const bolivianos = Number(nuevoPrecio.trim());
    const r = CatalogSchemas.CrearProducto.safeParse({
      categoryId: cat.id,
      nombre: nuevoNombre,
      precioBolivianos: bolivianos,
    });
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Datos incompletos');
      return;
    }
    void mutar(
      `crear-${cat.id}`,
      async () => {
        await call('/admin/products', 'POST', r.data);
        setCreandoEn(null);
        setNuevoNombre('');
        setNuevoPrecio('');
      },
      `"${r.data.nombre}" ya está en la carta.`,
    );
  }

  /**
   * Subir la foto de un plato.
   *
   * El tamaño se verifica en el cliente además del servidor: no por confiar en
   * el cliente, sino para no hacerle subir 4 MB por la red y recién entonces
   * mostrarle el error.
   */
  async function subirFoto(p: Producto) {
    setError('');
    setAviso('');
    try {
      const img = await elegirImagen(FOTO_MAX_BYTES);
      if (img === null) return; // canceló el selector
      await mutar(
        `foto-${p.id}`,
        () =>
          call(`/admin/products/${p.id}/foto`, 'PUT', {
            mime: img.mime,
            base64: img.base64,
          }),
        `Foto de "${p.nombre}" actualizada. El cliente ya la ve en la tablet.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function crearCategoria() {
    const r = CatalogSchemas.CrearCategoria.safeParse({nombre: nuevaCategoria});
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Nombre inválido');
      return;
    }
    void mutar(
      'crear-categoria',
      async () => {
        await call('/admin/categories', 'POST', r.data);
        setNuevaCategoria('');
      },
      `Categoría "${r.data.nombre}" creada.`,
    );
  }

  if (user?.rol !== 'ADMIN') {
    return (
      <Page title="La carta" subtitle="Platos, precios y qué se ofrece hoy.">
        <Notice
          tone="info"
          title="Solo la dueña"
          text="Los precios y la carta son decisión de la dueña. Si se acabó un plato, avisale para que lo saque del menú."
        />
      </Page>
    );
  }

  const platos = arbol?.flatMap((cat) => cat.productos) ?? [];
  const apagados = platos.filter((p) => !p.activo).length;

  return (
    <Page
      title="La carta"
      subtitle="Tocá un precio para cambiarlo. Nada se borra: los platos se dejan de ofrecer.">
      <Notice tone="error" text={error} />
      <Notice tone="success" text={aviso} />

      <View style={[s.card, s.row]}>
        <Text style={[s.muted, {flex: 1, minWidth: 180}]}>
          {platos.length} platos · {apagados} fuera de la carta ahora
        </Text>
        <Button title="Actualizar" variant="ghost" loading={cargando} onPress={() => void cargar()} />
        <Button
          title="Ver historial de cambios"
          variant="secondary"
          onPress={() => router.push('/auditoria')}
        />
      </View>

      {cargando && !arbol && (
        <>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </>
      )}

      {arbol?.length === 0 && (
        <EmptyState
          mark="✦"
          title="Todavía no hay categorías"
          text="Una categoría agrupa platos: Almuerzos, Bebidas, Postres. Creá la primera abajo y después agregale platos."
        />
      )}

      {arbol?.map((cat) => (
        <View
          key={cat.id}
          style={[
            s.cardRaised,
            {gap: space.md, opacity: cat.activo ? 1 : 0.6},
          ]}>
          <View style={s.row}>
            <Text style={[s.title, {flex: 1, minWidth: 140}]}>{cat.nombre}</Text>
            {!cat.activo && <Badge tone="warn" text="Categoría apagada" />}
            <Badge tone="neutral" text={`${cat.productos.length} platos`} />
          </View>

          <View style={s.row}>
            <Button
              title={cat.activo ? 'Apagar la categoría' : 'Reactivar la categoría'}
              variant={cat.activo ? 'ghost' : 'secondary'}
              loading={ocupado === `cat-${cat.id}`}
              onPress={() => {
                // Apagar cascadea: se pregunta. Reactivar no, porque no tiene
                // efecto en masa sobre los platos.
                if (cat.activo) setPorApagar(cat);
                else
                  void mutar(
                    `cat-${cat.id}`,
                    () =>
                      call(`/admin/categories/${cat.id}/activo`, 'PATCH', {activo: true}),
                    `"${cat.nombre}" volvió a la carta.`,
                  );
              }}
            />
            <Button
              title={creandoEn === cat.id ? 'Cancelar' : '+ Agregar plato acá'}
              variant="secondary"
              onPress={() => {
                setCreandoEn(creandoEn === cat.id ? null : cat.id);
                setNuevoNombre('');
                setNuevoPrecio('');
              }}
            />
          </View>

          {creandoEn === cat.id && (
            <View style={[s.card, {gap: space.sm}]}>
              <Text style={s.subtitle}>Plato nuevo en {cat.nombre}</Text>
              <Field
                label="Nombre del plato"
                value={nuevoNombre}
                onChangeText={setNuevoNombre}
                maxLength={80}
              />
              <Field
                label="Precio en bolivianos"
                hint="Enteros, sin centavos. Es una regla del sistema, no un límite del formulario."
                value={nuevoPrecio}
                onChangeText={setNuevoPrecio}
                keyboardType="number-pad"
              />
              <Button
                title="Agregar a la carta"
                loading={ocupado === `crear-${cat.id}`}
                onPress={() => crearProducto(cat)}
              />
            </View>
          )}

          {cat.productos.length === 0 && (
            <Text style={s.muted}>Esta categoría todavía no tiene platos.</Text>
          )}

          {cat.productos.map((p) => (
            <View
              key={p.id}
              style={[
                s.card,
                {
                  gap: space.sm,
                  opacity: p.activo ? 1 : 0.55,
                  borderLeftWidth: 3,
                  borderLeftColor: p.activo ? c.success : c.muted,
                },
              ]}>
              <View style={s.row}>
                <Text style={[s.subtitle, {flex: 1, minWidth: 140}]}>{p.nombre}</Text>
                {!p.activo && <Badge tone="warn" text="Fuera de la carta" />}
                {p.tieneVariantes && (
                  <Badge tone="info" text={`${p.variantes.length} tamaños`} />
                )}
              </View>

              {p.imagenUrl && <RemoteImage key={p.imagenUrl} uri={p.imagenUrl} />}
              {p.descripcion && <Text style={s.text}>{p.descripcion}</Text>}

              {/* Foto — RQ-206. El cliente la ve en el kiosco sin login; subirla
                  es solo de la dueña. */}
              <View style={s.row}>
                <Button
                  title={p.imagenUrl ? 'Cambiar la foto' : 'Agregar una foto'}
                  variant="ghost"
                  loading={ocupado === `foto-${p.id}`}
                  onPress={() => void subirFoto(p)}
                />
                {p.imagenUrl && (
                  <Button
                    title="Quitar la foto"
                    variant="ghost"
                    loading={ocupado === `quitar-foto-${p.id}`}
                    onPress={() =>
                      void mutar(
                        `quitar-foto-${p.id}`,
                        () => call(`/admin/products/${p.id}/foto`, 'DELETE'),
                        `"${p.nombre}" quedó sin foto. El plato sigue a la venta.`,
                      )
                    }
                  />
                )}
              </View>

              {/* Precio editable en la misma fila (PLAN §616). */}
              {editando === p.id ? (
                <View style={{gap: space.sm}}>
                  <Field
                    label="Precio nuevo en bolivianos"
                    hint="Cambiar un precio queda en el historial con tu nombre y la hora. Los pedidos ya hechos conservan el precio que tenían."
                    value={precioTexto}
                    onChangeText={setPrecioTexto}
                    keyboardType="number-pad"
                    autoFocus
                  />
                  <View style={s.row}>
                    <Button
                      grow
                      title="Guardar precio"
                      loading={ocupado === `precio-${p.id}`}
                      onPress={() => guardarPrecio(p)}
                    />
                    <Button
                      title="Cancelar"
                      variant="ghost"
                      onPress={() => setEditando(null)}
                    />
                  </View>
                </View>
              ) : (
                <View style={s.row}>
                  {p.tieneVariantes ? (
                    <Text style={[s.muted, {flex: 1, minWidth: 140}]}>
                      El precio está en cada tamaño
                    </Text>
                  ) : (
                    <>
                      <Text style={[s.price, {flex: 1, minWidth: 90}]}>
                        {money(p.precioCentavos)}
                      </Text>
                      <Button
                        title="Cambiar precio"
                        variant="secondary"
                        onPress={() => {
                          setEditando(p.id);
                          setPrecioTexto(String(Math.round(p.precioCentavos / 100)));
                          setError('');
                        }}
                      />
                    </>
                  )}
                  {/* Sin confirmación: es la acción más frecuente del día y es
                      reversible de un toque. No hay botón de borrar (RQ-204). */}
                  <Button
                    title={p.activo ? 'Se acabó' : 'Volver a ofrecer'}
                    variant={p.activo ? 'ghost' : 'secondary'}
                    loading={ocupado === `prod-${p.id}`}
                    onPress={() =>
                      void mutar(
                        `prod-${p.id}`,
                        () =>
                          call(`/admin/products/${p.id}/activo`, 'PATCH', {
                            activo: !p.activo,
                          }),
                        p.activo
                          ? `"${p.nombre}" salió de la carta. El kiosco ya no lo muestra.`
                          : `"${p.nombre}" volvió a la carta.`,
                      )
                    }
                  />
                </View>
              )}

              {p.tieneVariantes &&
                p.variantes.map((v) => (
                  <View key={v.id} style={[s.row, {opacity: v.activo ? 1 : 0.5}]}>
                    <Text style={[s.text, {flex: 1, minWidth: 100}]}>{v.nombre}</Text>
                    <Text style={s.textStrong}>{money(v.precioCentavos)}</Text>
                    {!v.activo && <Badge tone="warn" text="Apagado" />}
                  </View>
                ))}
            </View>
          ))}
        </View>
      ))}

      {/* Alta de categoría al final: se usa pocas veces, no compite con lo
          frecuente, que es tocar precios y apagar platos. */}
      <View style={[s.card, {gap: space.sm}]}>
        <Text style={s.subtitle}>Nueva categoría</Text>
        <Field
          label="Nombre"
          hint="Por ejemplo: Almuerzos, Bebidas, Postres."
          value={nuevaCategoria}
          onChangeText={setNuevaCategoria}
          maxLength={80}
        />
        <Button
          title="Crear categoría"
          secondary
          loading={ocupado === 'crear-categoria'}
          onPress={crearCategoria}
        />
      </View>

      <Dialog
        visible={porApagar !== null}
        title={`¿Apagar "${porApagar?.nombre ?? ''}"?`}
        onClose={() => setPorApagar(null)}>
        <Text style={s.text}>
          Sus {porApagar?.productos.length ?? 0} platos también salen de la carta: si
          la categoría desapareciera del kiosco pero sus platos siguieran activos, el
          panel mostraría platos que ningún cliente puede pedir. Se puede revertir.
        </Text>
        <View style={s.row}>
          <Button
            grow
            title="Sí, apagar la categoría"
            onPress={() => {
              const cat = porApagar;
              setPorApagar(null);
              if (!cat) return;
              void mutar(
                `cat-${cat.id}`,
                () =>
                  call(`/admin/categories/${cat.id}/activo`, 'PATCH', {activo: false}),
                `"${cat.nombre}" y sus platos salieron de la carta.`,
              );
            }}
          />
          <Button title="Cancelar" variant="ghost" onPress={() => setPorApagar(null)} />
        </View>
      </Dialog>
    </Page>
  );
}
