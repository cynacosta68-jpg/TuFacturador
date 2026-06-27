'use strict';

process.env.ARCANUM_MASTER_KEY = 'a'.repeat(64); // determinista para el vault

const test = require('node:test');
const assert = require('node:assert');

const vault = require('../src/crypto/vault');
const { assertSafeUrl } = require('../src/lib/ssrfguard');
const wsfev1 = require('../src/services/wsfev1');
const recovery = require('../src/auth/recovery');
const engine = require('../src/soap/engine');

test('vault: cifra y descifra (roundtrip)', () => {
  const enc = vault.encrypt('clave-secreta');
  assert.notEqual(enc, 'clave-secreta');
  assert.equal(vault.decrypt(enc), 'clave-secreta');
});

test('vault: detecta manipulacion (AES-GCM tag)', () => {
  const enc = vault.encrypt('x');
  const tampered = enc.slice(0, -3) + 'AAA';
  assert.throws(() => vault.decrypt(tampered));
});

test('ssrfguard: bloquea IPs internas/reservadas', () => {
  assert.throws(() => assertSafeUrl('http://127.0.0.1:6379'));
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'));
  assert.throws(() => assertSafeUrl('http://192.168.0.10'));
  assert.throws(() => assertSafeUrl('http://10.1.2.3'));
  assert.throws(() => assertSafeUrl('http://localhost:8094'));
  assert.doesNotThrow(() => assertSafeUrl('https://hooks.example.com/x'));
});

test('wsfev1.parseLoteCsv: parsea header + filas', () => {
  const csv =
    'cuit;puntoVenta;tipoComprobante;importeNeto;importeIva;importeTotal;alicuotaId\n' +
    '20111111112;1;11;100;21;121;5\n' +
    '20111111112;1;11;200;42;242;5';
  const r = wsfev1.parseLoteCsv(csv);
  assert.equal(r.length, 2);
  assert.equal(r[0].cuit, '20111111112');
  assert.equal(r[0].importeTotal, 121);
  assert.equal(r[0].alicuotasIva[0].id, 5);
  assert.equal(r[1].importeNeto, 200);
});

test('engine.toXml: objetos y arrays', () => {
  assert.equal(engine.toXml({ a: '1', b: { c: '2' } }), '<a>1</a><b><c>2</c></b>');
  assert.equal(engine.toXml({ l: [{ x: '1' }, { x: '2' }] }), '<l><x>1</x></l><l><x>2</x></l>');
});

test('recovery.looksLikeTokenError: especifico de token, no generico', () => {
  assert.ok(recovery.looksLikeTokenError(new Error('El token esta vencido')));
  assert.ok(recovery.looksLikeTokenError(new Error('ValidacionDeToken: invalido')));
  assert.ok(!recovery.looksLikeTokenError(new Error('error generico de conexion')));
});
