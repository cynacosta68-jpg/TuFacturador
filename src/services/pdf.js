'use strict';

// Generador de PDF de comprobantes — diseño minimalista, paleta azul oscuro.
// QR obligatorio (RG 4892) + codigo de barras del CAE + estructura RG 1415.
//
// MULTI-EMISOR (dinamico):
//   El emisor es quien se conecta a ARCA y valida la factura. Como ARCA no
//   devuelve los datos fiscales del emisor, se resuelven en este orden:
//     1) cmp.emisor              -> objeto pasado por comprobante (lo mas dinamico)
//     2) EMISORES[cmp.cuit]      -> registro por CUIT (datos fijos de cada emisor)
//     3) EMISORES.default        -> fallback
//   El receptor se resuelve con cmp.receptor (o se deriva de doc_tipo/doc_nro).
//
// Para registrar un emisor nuevo: agregá una entrada en EMISORES con su CUIT,
// o pasá { emisor: {...} } al generar. Lo mismo para el receptor con { receptor: {...} }.

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');

const norm = (c) => String(c == null ? '' : c).replace(/\D/g, '');

// ==== Registro de emisores (datos fiscales fijos por CUIT) ====
const fs = require('fs');
const path = require('path');
// Tabla de emisores: se lee de emisores.json (editable, fuera del codigo).
let EMISORES = { default: { razonSocial: '', domicilio: '', condicionIva: '', ingresosBrutos: '', inicioActividades: '' } };
try { EMISORES = Object.assign(EMISORES, JSON.parse(fs.readFileSync(path.join(__dirname, 'emisores.json'), 'utf8'))); }
catch (e) { console.error('[arcanum][pdf] no se pudo leer emisores.json:', e.message); }
// Override por variable de entorno: permite mantener los datos reales FUERA del repo
// publico. En el deploy se setea ARCANUM_EMISORES con el JSON real (pisa al ejemplo).
if (process.env.ARCANUM_EMISORES) {
  try { EMISORES = Object.assign(EMISORES, JSON.parse(process.env.ARCANUM_EMISORES)); }
  catch (e) { console.error('[arcanum][pdf] ARCANUM_EMISORES invalido:', e.message); }
}
function resolverEmisor(cmp) {
  const m = cmp.meta || {};
  return cmp.emisor || m.emisor || EMISORES[norm(cmp.cuit)] || EMISORES.default;
}
function resolverReceptor(cmp) {
  const m = cmp.meta || {};
  if (cmp.receptor) return cmp.receptor;
  if (m.receptor) return m.receptor;
  const cf = Number(cmp.doc_tipo) === 99;
  return {
    nombre: cf ? 'Consumidor Final' : '-',
    condicionIva: cf ? 'Consumidor Final' : (COND_IVA_REC[Number(cmp.doc_tipo)] || '-'),
    docTipo: cmp.doc_tipo, docNro: cmp.doc_nro,
  };
}

// ==== Paleta azul oscuro ====
const C = {
  ink: '#16233b',      // texto principal
  azul: '#152a4e',     // azul oscuro (encabezados, letra, total)
  azulSoft: '#34507f',
  rule: '#c4d0e3',     // hairline azul-gris
  label: '#7a8699',    // etiquetas
  faint: '#aab4c4',
};
C.azulSoft = '#34507f';

const TIPOS = { 1: 'FACTURA', 2: 'NOTA DE DÉBITO', 3: 'NOTA DE CRÉDITO', 6: 'FACTURA', 7: 'NOTA DE DÉBITO', 8: 'NOTA DE CRÉDITO', 11: 'FACTURA', 12: 'NOTA DE DÉBITO', 13: 'NOTA DE CRÉDITO', 51: 'FACTURA', 19: 'FACTURA', 201: 'FACTURA DE CRÉDITO', 202: 'NOTA DE DÉBITO MiPyME', 203: 'NOTA DE CRÉDITO MiPyME', 206: 'FACTURA DE CRÉDITO', 207: 'NOTA DE DÉBITO MiPyME', 208: 'NOTA DE CRÉDITO MiPyME', 211: 'FACTURA DE CRÉDITO', 212: 'NOTA DE DÉBITO MiPyME', 213: 'NOTA DE CRÉDITO MiPyME' };
const LETRA = { 1: 'A', 2: 'A', 3: 'A', 6: 'B', 7: 'B', 8: 'B', 11: 'C', 12: 'C', 13: 'C', 51: 'M', 19: 'E', 201: 'A', 202: 'A', 203: 'A', 206: 'B', 207: 'B', 208: 'B', 211: 'C', 212: 'C', 213: 'C' };
const COND_IVA_REC = { 1: 'IVA Responsable Inscripto', 4: 'IVA Sujeto Exento', 5: 'Consumidor Final', 6: 'Responsable Monotributo', 13: 'Monotributo Social' };
const DOC_TIPO = { 80: 'CUIT', 86: 'CUIL', 96: 'DNI', 99: 'Consumidor Final' };

function ymd(d) { if (!d) return ''; const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; }
function isoFecha(d) { const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : s; }
function ymdRaw(d) { const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || ''); const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/); return m ? `${m[1]}${m[2]}${m[3]}` : ''; }
function money(n) { return Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function qrUrl(cmp) {
  const data = { ver: 1, fecha: isoFecha(cmp.fecha), cuit: Number(norm(cmp.cuit)), ptoVta: Number(cmp.punto_venta), tipoCmp: Number(cmp.tipo_cbte), nroCmp: Number(cmp.numero), importe: Number(cmp.importe_total), moneda: cmp.moneda || 'PES', ctz: 1, tipoDocRec: Number(cmp.doc_tipo) || 99, nroDocRec: Number(cmp.doc_nro) || 0, tipoCodAut: 'E', codAut: Number(cmp.cae) };
  return 'https://www.afip.gob.ar/fe/qr/?p=' + Buffer.from(JSON.stringify(data)).toString('base64');
}

function digitoVerificador(num) { let im = 0, pa = 0; for (let i = 0; i < num.length; i++) { const d = +num[i]; if ((i + 1) % 2) im += d; else pa += d; } const r = (im * 3 + pa) % 10; return r === 0 ? 0 : 10 - r; }
function barcodeI2of5(doc, x, y, cmp, height) {
  const cae = norm(cmp.cae).padStart(14, '0').slice(-14);
  let base = norm(cmp.cuit).padStart(11, '0') + String(cmp.tipo_cbte).padStart(2, '0') + String(cmp.punto_venta).padStart(4, '0') + cae + (ymdRaw(cmp.cae_vto) || '00000000');
  base += String(digitoVerificador(base)); if (base.length % 2) base = '0' + base;
  const PAT = { 0: 'nnwwn', 1: 'wnnnw', 2: 'nwnnw', 3: 'wwnnn', 4: 'nnwnw', 5: 'wnwnn', 6: 'nwwnn', 7: 'nnnww', 8: 'wnnwn', 9: 'nwnwn' };
  const n = 1.05, w = n * 3; let cx = x;
  const bar = (width, fill) => { if (fill) doc.rect(cx, y, width, height).fill(C.ink); cx += width; };
  [n, n, n, n].forEach((v, i) => bar(v, i % 2 === 0));
  for (let i = 0; i < base.length; i += 2) { const a = PAT[base[i]], b = PAT[base[i + 1]]; for (let j = 0; j < 5; j++) { bar(a[j] === 'w' ? w : n, true); bar(b[j] === 'w' ? w : n, false); } }
  bar(w, true); bar(n, false); bar(n, true);
}

/** Devuelve un Buffer con el PDF del comprobante. */
async function generar(cmp) {
  const emisor = resolverEmisor(cmp);
  const receptor = resolverReceptor(cmp);
  const qrPng = await QRCode.toBuffer(await qrUrl(cmp), { margin: 0, width: 240, color: { dark: C.azul, light: '#ffffff' } });

  const doc = new PDFDocument({ size: 'A4', margins: { top: 40, bottom: 28, left: 40, right: 40 } });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const M = 40, R = 555, mid = 320;
  const letra = LETRA[cmp.tipo_cbte] || 'X';
  const tipoNombre = (TIPOS[cmp.tipo_cbte] || 'COMPROBANTE') + ' ' + letra;
  const t = (s, x, y, o) => doc.text(s == null ? '' : String(s), x, y, o);
  const label = (s, x, y, o) => doc.fillColor(C.label).fontSize(7).font('Helvetica').text(s, x, y, o);
  const val = (s, x, y, o) => doc.fillColor(C.ink).fontSize(9).font('Helvetica').text(s == null ? '-' : String(s), x, y, o);

  // ===== Encabezado =====
  let y = 46;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(C.azul).text(emisor.razonSocial || '—', M, y, { width: mid - M });
  y += 26;
  doc.font('Helvetica').fontSize(8.5).fillColor(C.label);
  const eline = (s) => { doc.fillColor(C.label).fontSize(8.5).text(s, M, y, { width: mid - M }); y += 13; };
  if (emisor.condicionIva) eline(emisor.condicionIva);
  if (emisor.domicilio) eline(emisor.domicilio);
  eline('CUIT ' + (norm(cmp.cuit)) + (emisor.ingresosBrutos ? '   ·   IIBB ' + emisor.ingresosBrutos : ''));
  if (emisor.inicioActividades) eline('Inicio de actividades: ' + emisor.inicioActividades);

  // letra limpia (sin linea cruzando), arriba a la derecha
  const lx = R - 50, ly = 46;
  doc.lineWidth(1).strokeColor(C.azul).rect(lx, ly, 50, 50).stroke();
  doc.font('Helvetica-Bold').fontSize(30).fillColor(C.azul).text(letra, lx, ly + 9, { width: 50, align: 'center' });
  doc.font('Helvetica').fontSize(6.5).fillColor(C.label).text('CÓD. ' + String(cmp.tipo_cbte).padStart(3, '0'), lx, ly + 54, { width: 50, align: 'center' });
  // tipo + datos del comprobante (right-aligned, a la izquierda de la letra)
  const rb = lx - 12, rbx = mid;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.azul).text(tipoNombre, rbx, 48, { width: rb - rbx, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(C.ink);
  let ry = 70;
  const rline = (s) => { doc.fillColor(C.ink).fontSize(8.5).text(s, rbx, ry, { width: rb - rbx, align: 'right' }); ry += 13; };
  rline('Punto de Venta ' + String(cmp.punto_venta).padStart(4, '0') + '   ·   Nº ' + String(cmp.numero).padStart(8, '0'));
  rline('Fecha de emisión: ' + ymd(cmp.fecha));

  // regla
  y = Math.max(y, 118) + 6;
  doc.lineWidth(1).strokeColor(C.rule).moveTo(M, y).lineTo(R, y).stroke();
  y += 12;

  // ===== Receptor =====
  doc.font('Helvetica-Bold').fontSize(8).fillColor(C.azulSoft).text('RECEPTOR', M, y); y += 13;
  label('Apellido y Nombre / Razón Social', M, y); label('Condición frente al IVA', mid, y);
  y += 9; val(receptor.nombre, M, y, { width: mid - M - 10 }); val(receptor.condicionIva, mid, y, { width: R - mid }); y += 18;
  const docNom = receptor.docTipo === 99 || Number(cmp.doc_tipo) === 99 ? 'Doc.' : (DOC_TIPO[Number(cmp.doc_tipo)] || 'Doc.');
  label(docNom, M, y); label('Condición de venta', mid, y);
  y += 9; val(receptor.docNro != null ? receptor.docNro : (cmp.doc_nro || '0'), M, y); val(cmp.condicionVenta || (cmp.meta && cmp.meta.condicionVenta) || 'Contado', mid, y); y += 18;
  const _periodo = cmp.periodo || (cmp.meta && cmp.meta.periodo);
  if (_periodo && (_periodo.desde || _periodo.hasta)) {
    label('Período facturado', M, y); y += 9;
    val(`${ymd(_periodo.desde)}  a  ${ymd(_periodo.hasta)}    ·    Vto. pago: ${ymd(_periodo.vtoPago || cmp.fecha)}`, M, y, { width: R - M }); y += 18;
  }

  // ===== Detalle =====
  y += 4;
  const cD = M, cC = 318, cP = 372, cB = 442, cS = R;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.label);
  t('DESCRIPCIÓN', cD, y); t('CANT.', cC, y, { width: 44, align: 'right' }); t('P. UNIT.', cP, y, { width: 60, align: 'right' }); t('BONIF.', cB, y, { width: 40, align: 'right' }); t('SUBTOTAL', cS - 80, y, { width: 80, align: 'right' });
  y += 11; doc.lineWidth(0.7).strokeColor(C.rule).moveTo(M, y).lineTo(R, y).stroke(); y += 7;
  const _items = cmp.items || (cmp.meta && cmp.meta.items);
  const items = Array.isArray(_items) && _items.length ? _items : [{ descripcion: 'Servicios', cantidad: 1, precioUnitario: Number(cmp.importe_total), bonif: 0, subtotal: Number(cmp.importe_total) }];
  doc.font('Helvetica').fontSize(9).fillColor(C.ink);
  for (const it of items) {
    const sub = it.subtotal != null ? it.subtotal : Number(it.cantidad || 1) * Number(it.precioUnitario || 0);
    doc.fillColor(C.ink).fontSize(9);
    t(it.descripcion || '-', cD, y, { width: cC - cD - 8 });
    t(money(it.cantidad ?? 1), cC, y, { width: 44, align: 'right' });
    t(money(it.precioUnitario ?? sub), cP, y, { width: 60, align: 'right' });
    t(money(it.bonif ?? 0), cB, y, { width: 40, align: 'right' });
    t(money(sub), cS - 80, y, { width: 80, align: 'right' });
    y += 15;
  }

  // ===== Totales (con IVA discriminado si corresponde) =====
  y += 6; doc.lineWidth(0.7).strokeColor(C.rule).moveTo(mid, y).lineTo(R, y).stroke(); y += 8;
  const _m = cmp.meta || {};
  const _neto = _m.importeNeto != null ? Number(_m.importeNeto) : null;
  const _iva = _m.importeIva != null ? Number(_m.importeIva) : null;
  const _mon = cmp.moneda || '$';
  const LBL_X = mid - 55, LBL_W = 135, VAL_X = mid + 90, VAL_W = R - (mid + 90);
  const rowTot = (lbl, v, bold) => {
    doc.font('Helvetica').fontSize(9).fillColor(C.label).text(lbl, LBL_X, bold ? y + 2 : y, { width: LBL_W, align: 'right' });
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 12 : 9).fillColor(bold ? C.azul : C.ink)
      .text(_mon + ' ' + money(v), VAL_X, y, { width: VAL_W, align: 'right', lineBreak: false });
    y += bold ? 18 : 14;
  };
  if (_iva != null && _iva > 0 && _neto != null) { rowTot('Neto Gravado', _neto, false); rowTot('IVA', _iva, false); }
  rowTot('Importe Total', cmp.importe_total, true);

  // ===== Pie: QR + CAE + barras =====
  const fy = 672;
  doc.lineWidth(0.7).strokeColor(C.rule).moveTo(M, fy - 12).lineTo(R, fy - 12).stroke();
  doc.image(qrPng, M, fy, { width: 96 });
  doc.font('Helvetica').fontSize(9).fillColor(C.label).text('CAE Nº', M + 112, fy + 4);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.ink).text(cmp.cae || '-', M + 112, fy + 14);
  doc.font('Helvetica').fontSize(8).fillColor(C.label).text('Vto. CAE  ' + ymd(cmp.cae_vto), M + 112, fy + 32);
  barcodeI2of5(doc, M + 112, fy + 50, cmp, 30);

  // leyendas
  let lyy = fy + 102;
  doc.fontSize(7).fillColor(C.label);
  if (letra === 'C') { t('Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes — Ley Nº 27.618', M, lyy, { width: R - M }); lyy += 11; }
  t('Comprobante autorizado por ARCA (ex AFIP)', M, lyy, { width: R - M });
  doc.fontSize(6.5).fillColor(C.faint).text('Generado por Arcanum', M, 802, { width: R - M, align: 'center' });

  doc.end();
  return done;
}

module.exports = { generar, qrUrl, EMISORES };
