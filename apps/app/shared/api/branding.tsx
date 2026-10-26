/**
 * Branding del local, compartido por toda la app.
 *
 * POR QUÉ UN CONTEXTO Y NO UN FETCH EN CADA PANTALLA
 * --------------------------------------------------
 * El nombre y el logo aparecen en la cabecera de las ocho pantallas. Si cada
 * una lo pidiera al montarse, pasar de la carta al kiosco dispararía otra
 * consulta para traer exactamente lo mismo, y la cabecera parpadearía con el
 * placeholder en cada navegación. Se pide una vez por sesión de app.
 *
 * NO HAY POLLING, A PROPÓSITO
 * ---------------------------
 * El nombre del local cambia una vez en la vida del restaurante. Consultarlo
 * cada pocos segundos sería gasto puro. Cuando la dueña lo cambia desde
 * `/local`, esa pantalla llama a `refrescar()` y la cabecera se actualiza al
 * instante en toda la app.
 *
 * FALLA EN SILENCIO
 * -----------------
 * Si la API no responde, se usa el nombre por defecto y la app sigue
 * funcionando. Un restaurante no deja de poder vender porque su logo no cargó:
 * los errores que importan (no se puede cobrar, no se puede pedir) ya se
 * muestran en su pantalla.
 */

import {createContext, useCallback, useContext, useEffect, useState} from 'react';
import type {BrandingDto} from '@restaurante/shared';
import {getApiUrl} from './config';

/** Lo que se muestra mientras carga o si la API no contesta. */
const PORDEFECTO: BrandingDto = {nombreLocal: 'Mi Restaurante', logoUrl: null};

type Valor = {branding: BrandingDto; refrescar: () => Promise<void>};

const Ctx = createContext<Valor>({
  branding: PORDEFECTO,
  refrescar: async () => {},
});

export function BrandingProvider({children}: {children: React.ReactNode}) {
  const [branding, setBranding] = useState<BrandingDto>(PORDEFECTO);

  const refrescar = useCallback(async () => {
    try {
      // Sin token: el branding es público, igual que el catálogo. El kiosco lo
      // necesita y no tiene login.
      const r = await fetch(`${getApiUrl()}/settings/branding`);
      if (!r.ok) return; // se queda el valor por defecto
      const b = (await r.json()) as BrandingDto;
      setBranding({
        nombreLocal: b.nombreLocal || PORDEFECTO.nombreLocal,
        logoUrl: b.logoUrl ?? null,
      });
    } catch {
      // Sin red: el nombre por defecto alcanza para que la app sirva.
    }
  }, []);

  useEffect(() => {
    void refrescar();
  }, [refrescar]);

  return <Ctx.Provider value={{branding, refrescar}}>{children}</Ctx.Provider>;
}

export function useBranding(): Valor {
  return useContext(Ctx);
}
