'use strict';

// ASESOR de tipo de comprobante. Devuelve una SUGERENCIA segun las condiciones
// fiscales del emisor y del receptor. NO reemplaza el criterio de un contador:
// la decision final (sobre todo FCE) deberia validarse profesionalmente.
//
// Reglas implementadas (RG 1415 / regimen FCE MiPyME):
//   - Emisor Monotributo o Exento -> SIEMPRE clase "C" (no discrimina IVA).
//   - Emisor Responsable Inscripto:
//       * Receptor Responsable Inscripto      -> clase "A" (discrimina IVA)
//       * Resto (CF, Monotributo, Exento, etc) -> clase "B" (IVA incluido)
//   - FCE (Factura de Credito Electronica MiPyME): se SUPERPONE a lo anterior
//     cuando  emisor.mipyme === true  Y  receptor es Empresa Grande  Y
//     importeTotal >= UMBRAL_FCE. (El dato "receptor Empresa Grande" hay que
//     proveerlo: ARCA tiene un padron de empresas grandes que debe consultarse.)

// Umbral FCE vigente desde 14/04/2026 (Resolucion 1/2026). Actualizable.
const UMBRAL_FCE = 5549862;

// Codigos de tipo de comprobante de ARCA
const TIPOS = {
  factura:      { A: 1,  B: 6,  C: 11 },
  notaDebito:   { A: 2,  B: 7,  C: 12 },
  notaCredito:  { A: 3,  B: 8,  C: 13 },
  // FCE MiPyME
  fceFactura:     { A: 201, B: 206, C: 211 },
  fceNotaDebito:  { A: 202, B: 207, C: 212 },
  fceNotaCredito: { A: 203, B: 208, C: 213 },
};

function norm(s) { return String(s || '').toLowerCase(); }
function esRI(c) { return /inscript/.test(norm(c)); }
function esMono(c) { return /monotrib/.test(norm(c)); }
function esExento(c) { return /exent/.test(norm(c)); }

/**
 * @param {object} p
 *   emisorCondicion    'Responsable Inscripto' | 'Responsable Monotributo' | 'Exento'
 *   emisorMipyme       boolean (esta inscripto en el registro MiPyME)
 *   receptorCondicion  condicion frente al IVA del receptor
 *   receptorGranEmpresa boolean (figura en el padron de Empresas Grandes de ARCA)
 *   importeTotal       number
 *   clase              'factura' | 'notaDebito' | 'notaCredito' (default 'factura')
 * @returns { letra, tipoComprobante, requiereIva, esFCE, motivo }
 */
function sugerirComprobante(p) {
  const clase = p.clase || 'factura';
  const emisorRI = esRI(p.emisorCondicion);
  const emisorMonoOExento = esMono(p.emisorCondicion) || esExento(p.emisorCondicion);

  // 1) Letra segun emisor x receptor
  let letra, requiereIva;
  if (emisorMonoOExento) {
    letra = 'C';
    requiereIva = false;
  } else if (emisorRI) {
    if (esRI(p.receptorCondicion)) { letra = 'A'; } else { letra = 'B'; }
    requiereIva = true; // A discrimina; B lo lleva incluido pero hay IVA en juego
  } else {
    // condicion de emisor no reconocida -> por defecto C, con aviso
    letra = 'C';
    requiereIva = false;
  }

  // 2) Overlay FCE
  const umbral = p.umbralFCE != null ? Number(p.umbralFCE) : UMBRAL_FCE;
  const aplicaFCE = !!p.emisorMipyme && !!p.receptorGranEmpresa && Number(p.importeTotal) >= umbral;
  const grupo = aplicaFCE
    ? (clase === 'notaDebito' ? 'fceNotaDebito' : clase === 'notaCredito' ? 'fceNotaCredito' : 'fceFactura')
    : clase;

  const tipoComprobante = TIPOS[grupo][letra];

  let motivo;
  if (emisorMonoOExento) motivo = `Emisor ${p.emisorCondicion}: clase C, sin discriminar IVA.`;
  else if (letra === 'A') motivo = 'Emisor RI a receptor RI: clase A, IVA discriminado.';
  else motivo = 'Emisor RI a receptor no inscripto: clase B.';
  if (aplicaFCE) motivo += ` Supera $${umbral.toLocaleString('es-AR')} a Empresa Grande siendo MiPyME -> FCE obligatoria (validar con contador).`;
  else if (p.emisorMipyme && p.receptorGranEmpresa && Number(p.importeTotal) < umbral) motivo += ` Por debajo del umbral FCE ($${umbral.toLocaleString('es-AR')}): factura comun.`;

  return { letra, tipoComprobante, requiereIva, esFCE: aplicaFCE, umbralFCE: umbral, motivo };
}


/**
 * Igual que sugerirComprobante, pero consulta a ARCA (wsfecred) si el receptor
 * esta obligado a recibir FCE y usa el umbral propio del receptor. Necesita
 * p.emisor (CUIT) y p.receptor (CUIT). Si la consulta falla, cae al flag manual.
 */
async function evaluarConPadron(p) {
  // Decision de FCE con el PISO FIJO (UMBRAL_FCE). A ARCA solo le preguntamos
  // si el receptor es Empresa Grande (obligado); su montoDesde NO decide, pero
  // si difiere del piso fijo se devuelve una ALERTA para revisar.
  let receptorGranEmpresa = !!p.receptorGranEmpresa;
  let fuentePadron = 'manual';
  let montoArca = null;
  let alerta = null;
  if (p.emisor && p.receptor) {
    try {
      const { consultarObligadoRecepcion } = require('./wsfecred');
      const r = await consultarObligadoRecepcion({
        emisor: p.emisor, receptor: p.receptor,
        representante: p.representante, fechaEmision: p.fechaEmision,
      });
      receptorGranEmpresa = r.obligado;
      montoArca = r.montoDesde;
      fuentePadron = 'ARCA (wsfecred)';
    } catch (e) {
      fuentePadron = 'consulta fallida: ' + e.message + ' (uso flag manual)';
    }
  }
  // FCE se decide con el piso fijo: no pasamos umbralFCE (sugerirComprobante usa UMBRAL_FCE)
  const sug = sugerirComprobante({ ...p, receptorGranEmpresa });
  if (montoArca != null && Number(montoArca) > 0 && Number(montoArca) !== UMBRAL_FCE) {
    alerta = `ATENCION: ARCA informa un umbral de $${Number(montoArca).toLocaleString('es-AR')} para este receptor, distinto del piso fijo $${UMBRAL_FCE.toLocaleString('es-AR')} que se esta aplicando. Revisar (sobre todo en produccion) para no caer en el rechazo 10192.`;
  }
  return { ...sug, receptorGranEmpresa, fuentePadron, umbralAplicado: UMBRAL_FCE, montoArca, alerta };
}

module.exports = { sugerirComprobante, evaluarConPadron, UMBRAL_FCE, TIPOS };
