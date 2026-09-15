# Remisiones

Generador de remisiones (notas de despacho) listo para desplegar en Vercel. Sin frameworks ni build: HTML, CSS y JavaScript puro, más una función serverless para el correo.

**Demo:** al abrirlo por primera vez carga una empresa de ejemplo, tres remisiones en el historial y una remisión de muestra en el editor. Edita los datos en **Configuración** y a partir de ahí es tuyo.

## Qué hace

| Función | Detalle |
|---|---|
| **Configuración inicial** | Datos de la empresa (nombre, NIT, dirección, contacto, logo), prefijo y consecutivo automático, IVA, moneda, términos al pie, plantillas de correo y WhatsApp. |
| **Nueva remisión** | Número automático, fecha, cliente con su **orden de compra** (y autocompletado de clientes anteriores), datos de entrega, ítems con totales en vivo y vista previa idéntica a la impresión. |
| **Imprimir** | Solo imprime el documento (formato A4). |
| **Descargar** | PDF (jsPDF), Excel `.xlsx` (SheetJS) y XML. |
| **Enviar por correo** | Con `RESEND_API_KEY` configurada en Vercel envía desde el servidor con el PDF adjunto; sin ella descarga el PDF y abre el cliente de correo con el mensaje listo. |
| **WhatsApp** | Abre `wa.me` con el número del cliente y el mensaje de la plantilla; descarga el PDF para adjuntarlo en el chat. |
| **Historial** | Búsqueda, filtro por estado, ver/editar, duplicar, descargar, eliminar, exportar todo a Excel y respaldo/importación en JSON. |

Los datos se guardan en el navegador (`localStorage`). Para pasarlos a otro equipo usa **Historial → Respaldo JSON** e impórtalo en el otro.

## Estructura

```
index.html          Interfaz (editor, historial, configuración, modal de correo)
css/styles.css      Estilos + reglas de impresión
js/storage.js       Persistencia en localStorage, numeración, respaldo
js/export.js        Totales, PDF, Excel, XML, plantillas
js/app.js           Lógica de la app (vistas, formulario, correo, WhatsApp, demo)
api/send-email.js   Función serverless de Vercel (Resend)
vercel.json         Configuración de Vercel
```

## Probar en local

No necesita Node. Cualquier servidor estático sirve:

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

En local la función `/api/send-email` no existe, así que el correo funciona en modo demo (abre tu cliente de correo).

## Desplegar en Vercel

1. Entra a [vercel.com/new](https://vercel.com/new) e importa `DuvanP11/remisiones_examples`.
2. Framework preset: **Other**. No hay comando de build ni carpeta de salida. Deploy.
3. (Opcional, para envío directo de correo) en **Settings → Environment Variables** agrega:

   | Variable | Valor |
   |---|---|
   | `RESEND_API_KEY` | API key de [resend.com](https://resend.com) |
   | `MAIL_FROM` | Remitente verificado, ej. `Remisiones <remisiones@tudominio.com>`. Para pruebas sirve `onboarding@resend.dev` (solo envía al correo de tu cuenta Resend). |

   Vuelve a desplegar y el indicador de la barra lateral cambiará a **"Correo: envío directo activo"**.

También puedes desplegar desde la terminal con `npx vercel` si tienes Node instalado.

## Notas

- El consecutivo solo avanza cuando guardas una remisión con el número automático; si escribes un número manual, no se consume.
- El logo se reduce a 480 px antes de guardarse para no llenar el `localStorage`.
- WhatsApp no permite adjuntar archivos por enlace: el botón descarga el PDF y abre el chat con el texto; el archivo se adjunta manualmente.
