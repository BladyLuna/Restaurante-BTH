import {describe, it, expect} from 'vitest';
import {
  anchoDe,
  esCompacto,
  paddingDe,
  anchoContenido,
  columnas,
  anchoColumna,
  rejilla,
  MAX_CONTENIDO,
} from '../shared/ui/layout';

describe('clasificacion de ventana', () => {
  it('separa celular, tablet y escritorio por los limites declarados', () => {
    expect(anchoDe(360)).toBe('compacto');
    expect(anchoDe(600)).toBe('compacto');
    expect(anchoDe(601)).toBe('medio');
    expect(anchoDe(1024)).toBe('medio');
    expect(anchoDe(1440)).toBe('amplio');
  });

  it('ante un ancho inservible asume tablet en vez de reventar', () => {
    expect(anchoDe(0)).toBe('medio');
    expect(anchoDe(Number.NaN)).toBe('medio');
    expect(esCompacto(375)).toBe(true);
    expect(esCompacto(1280)).toBe(false);
  });

  it('da mas aire cuanto mas grande la ventana', () => {
    expect(paddingDe(360)).toBe(16);
    expect(paddingDe(800)).toBe(24);
    expect(paddingDe(1600)).toBe(32);
  });
});

describe('ancho de contenido', () => {
  it('descuenta los paddings del ancho de ventana', () => {
    expect(anchoContenido(360)).toBe(360 - 16 * 2);
    expect(anchoContenido(800)).toBe(800 - 24 * 2);
  });

  it('nunca pasa del tope de legibilidad', () => {
    expect(anchoContenido(2000)).toBe(MAX_CONTENIDO - 32 * 2);
  });

  it('no devuelve negativos en ventanas absurdamente angostas', () => {
    expect(anchoContenido(10)).toBe(0);
  });
});

describe('columnas', () => {
  it('en celular angosto siempre cae a una sola columna', () => {
    expect(columnas(anchoContenido(360), 280)).toBe(1);
    expect(columnas(anchoContenido(414), 280)).toBe(1);
  });

  it('en tablet y escritorio abre columnas sin bajar del minimo', () => {
    expect(columnas(anchoContenido(1024), 280)).toBe(3);
    expect(columnas(anchoContenido(1600), 280)).toBe(4);
  });

  it('respeta el maximo pedido', () => {
    expect(columnas(anchoContenido(1600), 280, 16, 2)).toBe(2);
  });

  it('ninguna columna calculada queda por debajo del minimo', () => {
    for (const ventana of [320, 360, 414, 601, 768, 900, 1024, 1280, 1920]) {
      const disponible = anchoContenido(ventana);
      const cols = columnas(disponible, 280);
      if (cols > 1) expect(anchoColumna(disponible, cols)).toBeGreaterThanOrEqual(280);
    }
  });

  it('tolera entradas invalidas', () => {
    expect(columnas(0)).toBe(1);
    expect(columnas(Number.NaN)).toBe(1);
    expect(anchoColumna(0, 3)).toBe(0);
    expect(anchoColumna(300, 0)).toBe(300);
  });
});

describe('anchoColumna', () => {
  it('reparte el ancho descontando los gaps', () => {
    expect(anchoColumna(1000, 1, 16)).toBe(1000);
    expect(anchoColumna(1000, 2, 16)).toBe(492);
    expect(anchoColumna(1000, 3, 16)).toBe(322);
  });

  it('las columnas mas los gaps nunca superan el ancho disponible', () => {
    for (const disponible of [328, 376, 552, 720, 976, 1136]) {
      for (const cols of [1, 2, 3, 4]) {
        const b = anchoColumna(disponible, cols, 16);
        expect(b * cols + 16 * (cols - 1)).toBeLessThanOrEqual(disponible);
      }
    }
  });
});

describe('rejilla', () => {
  it('celular: una columna a ancho completo del contenido', () => {
    const r = rejilla(360, {min: 280});
    expect(r.ancho).toBe('compacto');
    expect(r.cols).toBe(1);
    expect(r.basis).toBe(anchoContenido(360));
  });

  it('escritorio: varias columnas que caben con sus gaps', () => {
    const r = rejilla(1440, {min: 280});
    expect(r.cols).toBeGreaterThan(1);
    expect(r.basis * r.cols + r.gap * (r.cols - 1)).toBeLessThanOrEqual(anchoContenido(1440));
  });

  it('descuenta el padding de la tarjeta contenedora', () => {
    const suelto = rejilla(1440, {min: 280});
    const dentro = rejilla(1440, {min: 280, restar: 48});
    expect(dentro.basis).toBeLessThan(suelto.basis);
  });
});
