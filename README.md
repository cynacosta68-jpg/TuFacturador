<div align="center">

# Arcanum

**El gateway que convierte el kilombo de ARCA en una API REST que un contador instala en un minuto.**

Self-hosted · Firma WSAA 100% local · Sin terceros · Sin suscripciones · Para automatizar con n8n

Parte de la suite **Escriba** · Licencia Apache-2.0

</div>

---

## El problema

Integrarse con los Web Services de ARCA (ex-AFIP) es, sin vueltas, un dolor de cabeza:

- Todo es **SOAP/XML** con WSDLs frágiles y namespaces caprichosos.
- Antes de pedir *cualquier* cosa tenés que pasar por **WSAA**: armar un *Ticket de Requerimiento de Acceso* (TRA), **firmarlo en formato CMS/PKCS#7** con tu certificado, mandarlo, y recién ahí recibís un *Token* y un *Sign*.
- Ese token **dura 12 horas y NO podés pedir otro antes** — ARCA te rechaza. Así que tenés que **cachearlo** y renovarlo en el momento justo.
- Hay **un certificado y endpoints distintos** para homologación y para producción, que no se pueden mezclar.
- Y todo esto **multiplicado por cada CUIT** que manejás y por cada uno de los ~20 servicios de ARCA.

Las alternativas existentes o cubren solo facturación, o son librerías que igual hay que programar, o —ojo— **mandan tu autenticación al servidor de un tercero**.

## La solución

Arcanum hace **todo ese trabajo sucio una sola vez, localmente**, y te expone una **API REST limpia** + una **interfaz web**. Tu clave privada **nunca sale del contenedor** ni pasa por nadie.

```
  n8n / tu sistema  ──HTTP REST──►  Arcanum  ──SOAP──►  ARCA
   (una llamada)                   (en tu server)      (homo o prod)
                                   ├─ firma WSAA local (CMS/PKCS#7)
                                   ├─ cachea Token+Sign 12h y los renueva solo
                                   ├─ traduce SOAP ⇄ JSON
                                   └─ Postgres (clientes, certs cifrados, auditoría)
```

Lo que para vos era *"armar el TRA, firmarlo, loguear a WSAA, cachear, armar el sobre SOAP, parsear el XML"* se transforma en:

```bash
curl -X POST https://tu-arcanum/api/ws/padron_a5/getPersona_v2 \
  -H "X-API-Key: TU_CLAVE" -H "Content-Type: application/json" \
  -d '{ "cuit": "20111111112", "params": { "idPersona": "20999999993" } }'
```
…y te vuelve el JSON con los datos del contribuyente. Arcanum resolvió el WSAA, la firma, el caché y el SOAP por vos.

---

## Cómo funciona (la magia, explicada)

### 1. Firma WSAA 100% local
El corazón del problema —firmar el TRA en CMS/PKCS#7— lo resuelve Arcanum **en memoria, dentro de tu contenedor**, con `node-forge`. **No se usa ningún SDK que llame a servidores de terceros.** Tu clave privada se guarda **cifrada en reposo (AES-256-GCM)** en la base; la master key vive en una variable de entorno, nunca en la DB.

### 2. Token cacheado y auto-recuperación
El *Ticket de Acceso* (Token+Sign) se cachea por **CUIT + servicio + entorno** en Postgres, con *advisory locks* para que dos pedidos simultáneos no disparen dos logins. Un *daemon* lo **renueva antes de que venza**, y si ARCA alguna vez rechaza por token vencido, Arcanum **reintenta solo** de forma transparente.

### 3. Catálogo de servicios editable + motor genérico
Todos los servicios de ARCA viven en un **catálogo declarativo** (endpoint, namespace, cómo autenticar, **guía de activación**). Esto da dos cosas:
- **Motor genérico** `POST /api/ws/{servicio}/{operación}`: llamás **cualquier** operación de **cualquier** servicio mandando un JSON. Arcanum arma el sobre y resuelve la auth.
- **Catálogo editable en vivo por el superadmin**: ARCA cambia endpoints seguido — los corregís desde la UI **sin redeployar** (se guardan en la base, auditado). Esto lo hace un tanque.

Sobre los más usados hay **módulos "ricos"** con validación y respuestas REST ergonómicas (ver más abajo).

### 4. Multi-cliente y multi-entorno
Manejás **varios CUITs** desde la misma instancia. Y cambiás entre **homologación y producción** desde la propia interfaz (menú → Entorno ARCA), en caliente y persistido — sin tocar variables ni redeployar.

---

## Instalación (un comando)

Requisitos: Docker. Generá los secretos:
```bash
openssl rand -hex 24   # ARCANUM_API_KEY     (protege la API)
openssl rand -hex 32   # ARCANUM_MASTER_KEY  (cifra las claves privadas — guardala bien)
```
Y levantá:
```bash
git clone <repo> arcanum && cd arcanum
cp .env.example .env        # completá ARCANUM_API_KEY, ARCANUM_MASTER_KEY y ARCANUM_ADMIN_PASS
docker compose up -d
```
Levanta Postgres + la app en el puerto **8094**. Entrá a **http://localhost:8094**.

Para **EasyPanel / Dokploy / Portainer** y el despliegue con imagen publicada, ver [DESPLIEGUE.md](DESPLIEGUE.md).

---

## La interfaz web

Panel limpio (tema claro/oscuro, sin frameworks), con todo lo que un contador necesita:

- **Panel**: métricas en vivo — emisiones del día, monto, tokens vigentes, certificados por vencer, peticiones, y **estado de cada servicio de ARCA** (uptime + latencia, con monitoreo automático).
- **Clientes**: alta de un CUIT generando el **CSR** del lado del server, pegando después el `.crt` de ARCA; o **importar un par clave+certificado** que ya tengas. Ves vigencia y estado.
- **Servicios**: el catálogo completo, con **guía de activación paso a paso** por servicio (qué asociar en el Administrador de Relaciones de Clave Fiscal). El superadmin puede editar/agregar servicios acá.
- **Emitir**: formulario para sacar un comprobante y obtener el CAE.
- **Comprobantes**: listado, descarga del **PDF con QR de ARCA**, export CSV para Libro IVA.
- **Generador**: armás la consulta y te genera el **nodo de n8n listo para pegar** + snippets en **cURL / JavaScript / Python**. Incluye un explorador que **lee el WSDL en vivo** y te lista operaciones y campos.
- **Webhooks** y **Usuarios** (con roles).

---

## Servicios de ARCA cubiertos

Todos accesibles vía el motor genérico (`/api/ws/...`). Los marcados **rico** tienen además endpoints REST dedicados con validación.

| Servicio | Para qué | Soporte |
|---|---|---|
| **WSFEv1** | Factura electrónica nacional (A/B/C/M, CAE) | **rico** |
| WSFEXv1 | Factura de exportación | genérico |
| WSMTXCA | Factura con detalle de ítems | genérico |
| WSBFEv1 | Bonos fiscales | genérico |
| WSCT | Comprobantes de turismo | genérico |
| WSFECRED | Factura de Crédito MiPyME (FCE) | genérico |
| **Padrón A5** | Constancia de inscripción / datos del contribuyente | **rico** |
| **Padrón A13** | Mi Categoría / datos de monotributo | **rico** |
| WSCDC | Constatación de comprobantes (validar CAE) | genérico |
| WSCTG | Código de Trazabilidad de Granos | genérico |
| WSLPG / WSLSP | Liquidación de granos / sector pecuario | genérico |
| WSLUM / WSLTV | Liquidación lechera / tabaco | genérico |
| WSREMCARNE / HARINA / AZUCAR | Remitos electrónicos | genérico |

> Un servicio genérico se "asciende" a rico cuando hace falta. Y el superadmin puede sumar cualquier WS nuevo desde la UI sin tocar código.

---

## Conectar a n8n

Un solo nodo **HTTP Request**:
- **Method** `POST`, **URL** `https://tu-arcanum/api/ws/padron_a5/getPersona_v2` (o el endpoint que necesites)
- Credencial **Header Auth** → Name `X-API-Key`, Value tu clave
- **Body (JSON)**: `{ "cuit": "20111111112", "params": { "idPersona": "{{ $json.cuit }}" } }`

Listo: sin nodos de WSAA, sin firmar a mano. Y desde la pestaña **Generador** de la UI te sale el nodo ya armado para copiar y pegar.

Arcanum también te puede avisar a vos: configurás **webhooks** (firmados con HMAC) que disparan ante eventos — `comprobante_emitido`, `cert_por_vencer`, `arca_caido`, etc.

---

## Endpoints principales

| | |
|---|---|
| `POST /api/wsfev1/comprobantes` | Emitir y obtener CAE (auto-numeración, idempotencia, validación de importes) |
| `GET  /api/wsfev1/consultar` | Reimprimir / verificar un comprobante |
| `GET  /api/padron/a5/{cuit}` · `a13` | Consulta de padrón (módulo rico) |
| `POST /api/ws/{servicio}/{operación}` | Genérico: cualquier servicio del catálogo |
| `GET  /api/services` · `/api/services/{id}/operaciones` | Catálogo + introspección de WSDL |
| `GET  /api/comprobantes` · `/export.csv` · `/{…}/pdf` | Comprobantes, export y PDF con QR |
| `GET  /api/metrics` · `/metrics` | Métricas (JSON y Prometheus) |
| `GET /docs` | OpenAPI interactivo |

Toda la API se autentica con `X-API-Key` (ideal para n8n) o con la sesión del panel.

---

## Seguridad

- **Firma local**: la clave privada se usa solo para firmar el TRA, en memoria, dentro del contenedor. No se transmite a ningún lado.
- **Cifrado en reposo**: claves privadas cifradas con AES-256-GCM; la master key vive fuera de la base.
- **Roles**: superadmin / admin / operador / lectura. Las operaciones sensibles (clientes, webhooks, usuarios, catálogo) exigen rol.
- **Scope por CUIT** opcional: un usuario puede quedar limitado a ciertos CUITs (cierra el acceso cruzado).
- **Anti fuerza bruta** en el login, **anti-SSRF** en los webhooks, comparaciones en tiempo constante, imagen sin root, auditoría de peticiones (usuario + IP).
- En producción: `ARCANUM_ENV=prod`, secretos propios y detrás de HTTPS.

---

## Versionado y CI

Cada `git push` dispara **GitHub Actions**, que **buildea y publica la imagen multi-arch** (amd64 + arm64) en GHCR — sin tokens manuales. En cada deploy se sube el *patch* de la versión, que se ve en el menú **Acerca de**, para confirmar de un vistazo que el deploy tomó.

## Estado y roadmap

Operativo y verificado **end-to-end contra ARCA producción** (firma WSAA, consulta de padrón con datos reales, monitoreo de servicios). Roadmap: promover WSFEX/MTXCA/agro a módulos ricos, lotes y CAEA, federación con Lockatus (SSO de la suite). Ver [CHANGELOG.md](CHANGELOG.md).

## Tests
```bash
npm install && npm test
```

## Licencia
Apache-2.0. Arcanum no está afiliado ni respaldado por ARCA/AFIP.
