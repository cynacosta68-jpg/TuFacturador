'use strict';

// Consulta al WS de Factura de Credito Electronica MiPyME (wsfecred).
// Metodo consultarMontoObligadoRecepcion: dado un CUIT receptor y una fecha,
// ARCA responde si ese receptor esta OBLIGADO a recibir FCE (es Empresa Grande)
// y desde que MONTO (umbral propio de ese receptor, segun su actividad).
//
// IMPORTANTE: el bloque de autenticacion de wsfecred es distinto al de wsfev1
// (authRequest/cuitRepresentada, namespace propio). Requiere delegar el servicio
// "wsfecred" (Registro de FCE MiPyMEs) en ARCA, ademas del de facturacion.

const { post } = require('../soap/client');
const { getAccessTicket } = require('../auth/wsaa');
const { config } = require('../config');
const { normalizeCuit } = require('../auth/tenants');

const SERVICE = 'wsfecred';
const NS = 'http://ar.gob.afip.wsfecred/FECredService/';

function fechaISO(d) {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '');
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return new Date().toISOString().slice(0, 10);
}

/**
 * Consulta si un receptor esta obligado a recibir FCE.
 * @param {object} p
 *   emisor        CUIT del emisor (cuitRepresentada en el authRequest)
 *   receptor      CUIT a consultar (cuitConsultada)
 *   representante CUIT del certificado que autentica (si emite por terceros)
 *   fechaEmision  fecha del comprobante (default: hoy)
 * @returns {Promise<{obligado:boolean, montoDesde:number|null, raw:object}>}
 */
async function consultarObligadoRecepcion(p) {
  const emisorCuit = normalizeCuit(p.emisor);
  const receptorCuit = normalizeCuit(p.receptor);
  const certCuit = p.representante ? normalizeCuit(p.representante) : emisorCuit;
  const ta = await getAccessTicket(certCuit, SERVICE);

  const env =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="${NS}">` +
    '<soapenv:Header/><soapenv:Body>' +
    '<ns1:consultarMontoObligadoRecepcionRequest>' +
    '<authRequest>' +
    `<token>${ta.token}</token>` +
    `<sign>${ta.sign}</sign>` +
    `<cuitRepresentada>${emisorCuit}</cuitRepresentada>` +
    '</authRequest>' +
    `<cuitConsultada>${receptorCuit}</cuitConsultada>` +
    `<fechaEmision>${fechaISO(p.fechaEmision)}</fechaEmision>` +
    '</ns1:consultarMontoObligadoRecepcionRequest>' +
    '</soapenv:Body></soapenv:Envelope>';

  const body = await post(config.endpoints.wsfecred, NS + 'consultarMontoObligadoRecepcion', env);
  const ret =
    body?.consultarMontoObligadoRecepcionResponse?.consultarMontoObligadoRecepcionReturn ||
    body?.consultarMontoObligadoRecepcionReturn ||
    body || {};

  const obligado = String(ret.obligado ?? '').trim().toUpperCase() === 'S';
  const montoDesde = ret.montoDesde != null && ret.montoDesde !== '' ? Number(ret.montoDesde) : null;
  return { obligado, montoDesde, raw: ret };
}

module.exports = { consultarObligadoRecepcion, SERVICE };
