/**
 * Función serverless de Vercel: envía la remisión por correo usando Resend (https://resend.com).
 *
 * Variables de entorno necesarias en Vercel:
 *   RESEND_API_KEY  -> API key de Resend
 *   MAIL_FROM       -> remitente verificado, ej. "Remisiones <remisiones@midominio.com>"
 *                      (para pruebas sirve "onboarding@resend.dev", que solo envía al correo de tu cuenta Resend)
 *
 * GET  /api/send-email -> { configured: true|false }
 * POST /api/send-email -> { to, cc?, subject, message, pdfBase64?, filename? }
 */
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  const configured = Boolean(key && from);

  if (req.method === 'GET') {
    return res.status(200).json({ configured });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  if (!configured) {
    return res.status(501).json({ error: 'El envío de correo no está configurado (RESEND_API_KEY / MAIL_FROM).', configured: false });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const { to, cc, subject, message, pdfBase64, filename } = body || {};

  const emailOk = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim());
  if (!emailOk(to)) return res.status(400).json({ error: 'Destinatario inválido.' });
  if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'El asunto es obligatorio.' });
  const ccList = String(cc || '').split(',').map(s => s.trim()).filter(emailOk);

  const text = String(message || '');
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;white-space:pre-wrap">' +
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>';

  const payload = { from, to: [String(to).trim()], subject: String(subject).trim(), text, html };
  if (ccList.length) payload.cc = ccList;
  if (pdfBase64) {
    if (String(pdfBase64).length > 6 * 1024 * 1024) return res.status(413).json({ error: 'El PDF adjunto es demasiado grande.' });
    payload.attachments = [{ filename: filename || 'remision.pdf', content: pdfBase64 }];
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(502).json({ error: data.message || data.error || 'Resend rechazó el envío.' });
    }
    return res.status(200).json({ ok: true, id: data.id });
  } catch (err) {
    return res.status(500).json({ error: 'No se pudo contactar el servicio de correo: ' + err.message });
  }
};
