'use strict';

// Consulta y export de comprobantes emitidos (lo que guardamos al obtener CAE).

const db = require('../db');
const { config } = require('../config');
const { normalizeCuit } = require('../auth/tenants');

async function get(cuit, ptoVta, tipo, numero, entorno = config.env) {
  const { rows } = await db.query(
    `SELECT * FROM comprobantes WHERE cuit=$1 AND entorno=$2 AND punto_venta=$3 AND tipo_cbte=$4 AND numero=$5`,
    [normalizeCuit(cuit), entorno, parseInt(ptoVta, 10), parseInt(tipo, 10), parseInt(numero, 10)],
  );
  return rows[0] || null;
}

async function list({ cuit, desde, hasta, limit = 200, entorno = config.env } = {}) {
  const cond = ['entorno = $1'];
  const params = [entorno];
  if (cuit) {
    params.push(normalizeCuit(cuit));
    cond.push(`cuit = $${params.length}`);
  }
  if (desde) {
    params.push(desde);
    cond.push(`fecha >= $${params.length}`);
  }
  if (hasta) {
    params.push(hasta);
    cond.push(`fecha <= $${params.length}`);
  }
  params.push(Math.min(parseInt(limit, 10) || 200, 5000));
  const { rows } = await db.query(
    `SELECT cuit, punto_venta, tipo_cbte, numero, cae, cae_vto, fecha, importe_total, doc_tipo, doc_nro, resultado, meta, enviado_at, enviado_to, created_at
     FROM comprobantes WHERE ${cond.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function exportCsv(filters) {
  let rows = await list({ ...filters, limit: 5000 });
  const perfil = filters && filters.perfil;
  if (perfil) rows = rows.filter((r) => { const m = r.meta || {}; const p = m.perfil || ((m.receptor && m.receptor.global) ? 'asociacion' : 'pyme'); return p === perfil; });
  // [etiqueta visible, clave]
  const pyme = perfil === 'pyme';
  const cols = pyme ? [
    ['cuit', 'cuit'],
    ['N° Comprobante', 'nro_comprobante'],
    ['tipo_cbte', 'tipo_cbte'],
    ['Receptor', 'receptor_nombre'],
    ['CUIT / Doc receptor', 'doc_nro'],
    ['Tipo de prestaciones', 'tipo_prestaciones'],
    ['cae', 'cae'],
    ['cae_vto', 'cae_vto'],
    ['fecha', 'fecha'],
    ['importe_total', 'importe_total'],
  ] : [
    ['cuit', 'cuit'],
    ['N° Comprobante', 'nro_comprobante'],
    ['tipo_cbte', 'tipo_cbte'],
    ['Comprobante asociado', 'comprobante_asociado'],
    ['cae', 'cae'],
    ['cae_vto', 'cae_vto'],
    ['fecha', 'fecha'],
    ['importe_total', 'importe_total'],
    ['doc_tipo', 'doc_tipo'],
    ['doc_nro', 'doc_nro'],
    ['resultado', 'resultado'],
  ];
  const lines = [cols.map((c) => c[0]).join(';')];
  for (const r of rows) {
    const global = (r.meta && r.meta.receptor && r.meta.receptor.global) || '';
    const conc = (r.meta && r.meta.concepto) || null;
    const val = (key) => {
      if (key === 'comprobante_asociado') return global;
      if (key === 'receptor_nombre') return (r.meta && r.meta.receptor && r.meta.receptor.nombre) || '';
      if (key === 'nro_comprobante') return String(r.punto_venta).padStart(5, '0') + '-' + String(r.numero).padStart(8, '0');
      if (key === 'tipo_prestaciones') return conc === 1 ? 'Bienes' : conc === 2 ? 'Servicios' : conc === 3 ? 'Ambas' : '';
      const v = r[key];
      return v instanceof Date ? v.toISOString().slice(0, 10) : v;
    };
    lines.push(cols.map((c) => csvEscape(val(c[1]))).join(';'));
  }
  return lines.join('\n');
}

module.exports = { get, list, exportCsv };
