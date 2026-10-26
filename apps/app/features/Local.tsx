/**
 * B5 — Gestión del local: nombre y logo (pantalla de la dueña)
 *
 * Fuente: ARQUITECTURA §1 ("la configuración vive en tabla, no en .env, para
 * que la dueña pueda cambiarla sin reiniciar nada"), PLAN §5g (solo ADMIN),
 * docs/settings-branding.md.
 *
 * Qué resuelve: hoy el kiosco dice "Mi Restaurante" hasta que alguien edite la
 * base. Esta pantalla es lo que hace que el sistema se vea como el local de la
 * dueña y no como un sistema genérico.
 *
 * Dos notas de diseño:
 *
 *   - LOS DOS CAMPOS SON INDEPENDIENTES. Cambiar el logo no toca el nombre, y
 *     al revés. La API acepta cada campo por separado, así que la pantalla
 *     manda solo lo que cambió: mandar el nombre junto con cada logo haría que
 *     un logo nuevo pise un nombre a medio escribir.
 *
 *   - LA VISTA PREVIA ES LA REAL. Después de guardar se vuelve a pedir el
 *     branding al servidor y se pinta esa respuesta, no el archivo local. Si
 *     el servidor rechazó la imagen o la guardó distinto, la dueña lo ve acá y
 *     no se entera recién cuando mira el kiosco.
 */

import {useCallback, useEffect, useState} from 'react';
import {View, Text, Image} from 'react-native';
import {router} from 'expo-router';
import {LOGO_MAX_BYTES, type BrandingDto} from '@restaurante/shared';
import {useSession} from '../shared/api/session';
import {errorMessage} from '../shared/api/errors';
import {apiUrl} from '../shared/api/session';
import {useBranding} from '../shared/api/branding';
import {elegirImagen} from '../shared/api/imagen';
import {
  Page,
  Button,
  Field,
  Notice,
  Badge,
  useUi,
  space,
} from '../shared/ui';

export default function Local() {
  const {s, colors: c, type: t} = useUi();
  const {call, user} = useSession();
  const {refrescar: refrescarCabecera} = useBranding();

  const [branding, setBranding] = useState<BrandingDto | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      const b = await call<BrandingDto>('/settings/branding');
      setBranding(b);
      setNombre(b.nombreLocal);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setCargando(false);
    }
  }, [call]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Toda mutación recarga desde el servidor: la verdad es su respuesta. */
  async function mutar(clave: string, cuerpo: object, exito: string) {
    if (ocupado) return;
    setOcupado(clave);
    setError('');
    setAviso('');
    try {
      const b = await call<BrandingDto>('/admin/settings/branding', 'PUT', cuerpo);
      setBranding(b);
      setNombre(b.nombreLocal);
      // La cabecera de TODA la app lo muestra: sin esto habria que recargar
      // la pagina para ver el cambio que acabas de hacer.
      await refrescarCabecera();
      setAviso(exito);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOcupado('');
    }
  }

  async function subirLogo() {
    setError('');
    setAviso('');
    try {
      const img = await elegirImagen(LOGO_MAX_BYTES);
      if (img === null) return; // canceló
      await mutar(
        'logo',
        {logo: {mime: img.mime, base64: img.base64}},
        'Logo actualizado. El kiosco ya lo muestra.',
      );
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (user?.rol !== 'ADMIN') {
    return (
      <Page title="El local" subtitle="Nombre y logo que ve el cliente.">
        <Notice
          tone="info"
          title="Solo la dueña"
          text="La identidad del local es decisión de la dueña, igual que los precios."
        />
      </Page>
    );
  }

  const nombreCambio =
    branding !== null && nombre.trim() !== '' && nombre.trim() !== branding.nombreLocal;

  return (
    <Page
      title="El local"
      subtitle="El nombre y el logo que el cliente ve en la tablet antes de pedir.">
      <Notice tone="error" text={error} />
      <Notice tone="success" text={aviso} />

      {/* Vista previa: lo que ve el cliente, tal como lo va a ver. */}
      <View style={[s.cardRaised, {gap: space.md, alignItems: 'center'}]}>
        <Badge tone="info" text="Así lo ve el cliente" />
        {branding?.logoUrl ? (
          <Image
            accessibilityLabel="Logo del local"
            source={{uri: apiUrl() + branding.logoUrl}}
            resizeMode="contain"
            style={{width: 160, height: 160, borderRadius: 12}}
          />
        ) : (
          <View
            style={{
              width: 160,
              height: 160,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: c.line,
              backgroundColor: c.bgAlt,
              alignItems: 'center',
              justifyContent: 'center',
              gap: space.sm,
            }}>
            <Text style={{fontSize: 34, color: c.faint}}>◴</Text>
            <Text style={[t.caption, {textAlign: 'center', paddingHorizontal: space.md}]}>
              Todavía sin logo
            </Text>
          </View>
        )}
        <Text style={s.title}>{branding?.nombreLocal ?? '—'}</Text>
      </View>

      {/* Nombre. Se manda solo si cambió. */}
      <View style={[s.card, {gap: space.sm}]}>
        <Text style={s.subtitle}>Nombre del local</Text>
        <Field
          label="Cómo se llama tu restaurante"
          hint="Aparece en el encabezado de la tablet y en los paneles del personal."
          value={nombre}
          onChangeText={setNombre}
          maxLength={60}
          editable={!cargando}
        />
        <Button
          title="Guardar el nombre"
          loading={ocupado === 'nombre'}
          disabled={!nombreCambio}
          onPress={() =>
            void mutar(
              'nombre',
              {nombreLocal: nombre.trim()},
              `El local ahora se llama "${nombre.trim()}".`,
            )
          }
        />
        {!nombreCambio && branding !== null && (
          <Text style={s.muted}>Escribí un nombre distinto para poder guardarlo.</Text>
        )}
      </View>

      {/* Logo. */}
      <View style={[s.card, {gap: space.sm}]}>
        <Text style={s.subtitle}>Logo</Text>
        <Text style={s.muted}>
          PNG, JPEG o WEBP, hasta {Math.round(LOGO_MAX_BYTES / 1024)} kB. Si lo sacás
          con el celular, se abre la cámara directamente.
        </Text>
        <View style={s.row}>
          <Button
            grow
            title={branding?.logoUrl ? 'Cambiar el logo' : 'Subir un logo'}
            secondary
            loading={ocupado === 'logo'}
            onPress={() => void subirLogo()}
          />
          {branding?.logoUrl && (
            <Button
              title="Quitar"
              variant="ghost"
              loading={ocupado === 'quitar-logo'}
              onPress={() =>
                void mutar(
                  'quitar-logo',
                  {logo: null},
                  'Logo quitado. El kiosco vuelve a mostrar solo el nombre.',
                )
              }
            />
          )}
        </View>
      </View>

      <View style={[s.card, s.row]}>
        <Text style={[s.muted, {flex: 1, minWidth: 180}]}>
          Cada cambio queda registrado con tu nombre y la hora.
        </Text>
        <Button
          title="Ver historial"
          variant="secondary"
          onPress={() => router.push('/auditoria')}
        />
        <Button title="La carta" variant="ghost" onPress={() => router.push('/carta')} />
      </View>
    </Page>
  );
}
