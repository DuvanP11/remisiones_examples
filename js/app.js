/* Lógica de la aplicación: navegación, editor, historial, configuración, correo y WhatsApp. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const isoLocal = d => { const x = new Date(d); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const hoy = () => isoLocal(new Date());
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); let a = o; for (const k of ks.slice(0, -1)) { if (typeof a[k] !== 'object' || a[k] === null) a[k] = {}; a = a[k]; } a[ks[ks.length - 1]] = v; };

  let config = Storage.getConfig();
  let current = null;        // remisión en edición
  let esNueva = true;        // aún no consume consecutivo
  let emailConfigurado = null;

  // ================= Toast =================
  let toastTimer;
  function toast(msg, tipo = '') {
    const el = $('#toast');
    el.textContent = msg; el.className = 'toast show ' + tipo;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ================= Navegación =================
  function showView(name) {
    $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + name));
    $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    if (name === 'historial') renderHistorial();
    if (name === 'config') fillConfigForm();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
    window.scrollTo({ top: 0 });
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-view]');
    if (b) showView(b.dataset.view);
  });

  // ================= Modelo =================
  function nuevaRemision() {
    return {
      id: uid(), numero: Storage.nextNumber(config), fecha: hoy(), fechaEntrega: '', estado: 'borrador',
      cliente: { nombre: '', documento: '', direccion: '', ciudad: '', telefono: '', email: '', ordenCompra: '' },
      entrega: { direccion: '', ciudad: '', transportador: '', placa: '', guia: '' },
      items: [itemVacio()],
      observaciones: '', aplicaIva: !!config.remision.aplicaIva,
      creadoEn: new Date().toISOString(), actualizadoEn: null, enviadoA: []
    };
  }
  const itemVacio = () => ({ codigo: '', descripcion: '', cantidad: 1, unidad: 'UND', precio: 0 });

  function cargar(rem, nueva) {
    current = JSON.parse(JSON.stringify(rem));
    if (!current.items || !current.items.length) current.items = [itemVacio()];
    // Compatibilidad: la orden de compra vivía en "entrega" en versiones anteriores
    if (!current.cliente.ordenCompra && current.entrega?.ordenCompra) { current.cliente.ordenCompra = current.entrega.ordenCompra; delete current.entrega.ordenCompra; }
    esNueva = !!nueva;
    fillForm();
    renderItems();
    renderPreview();
    actualizarEstadoEditor();
    showView('nueva');
  }

  function actualizarEstadoEditor() {
    $('#editor-title').textContent = esNueva ? 'Nueva remisión' : `Remisión ${current.numero}`;
    const p = $('#editor-estado');
    const est = esNueva ? 'sin guardar' : (current.estado || 'guardada');
    p.textContent = { 'sin guardar': 'Sin guardar', guardada: 'Guardada', enviada: 'Enviada', borrador: 'Borrador' }[est] || est;
    p.className = 'pill ' + ({ 'sin guardar': 'pill-muted', guardada: 'pill-info', enviada: 'pill-ok' }[est] || 'pill-muted');
  }

  // ================= Formulario =================
  function fillForm() {
    $$('#view-nueva [data-bind]').forEach(el => {
      const v = getPath(current, el.dataset.bind);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    $('#iva-pct').textContent = config.remision.iva;
    const dl = $('#lista-clientes');
    dl.innerHTML = Storage.clientesConocidos().map(c => `<option value="${esc(c.nombre)}">`).join('');
  }
  $('#view-nueva').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.bind) {
      setPath(current, el.dataset.bind, el.type === 'checkbox' ? el.checked : el.value);
      if (el.dataset.bind === 'aplicaIva') renderTotals();
      renderPreview();
    } else if (el.dataset.item !== undefined) {
      const idx = +el.closest('tr').dataset.idx;
      current.items[idx][el.dataset.item] = el.value;
      if (el.dataset.item === 'cantidad' || el.dataset.item === 'precio') {
        el.closest('tr').querySelector('.total-cell').textContent = Exporter.fmtMoney(Exporter.num(current.items[idx].cantidad) * Exporter.num(current.items[idx].precio), config.remision.moneda);
        renderTotals();
      }
      renderPreview();
    }
  });
  // Autocompletar cliente conocido
  $('[data-bind="cliente.nombre"]').addEventListener('change', e => {
    const c = Storage.clientesConocidos().find(x => x.nombre === e.target.value);
    if (c) { current.cliente = { ...current.cliente, ...c, nombre: c.nombre, ordenCompra: current.cliente.ordenCompra }; fillForm(); renderPreview(); }
  });

  // ---- Ítems
  function renderItems() {
    const tb = $('#items-body');
    const mon = config.remision.moneda;
    tb.innerHTML = current.items.map((it, i) => `
      <tr data-idx="${i}">
        <td><input type="text" data-item="codigo" value="${esc(it.codigo)}" placeholder="SKU"></td>
        <td><input type="text" data-item="descripcion" value="${esc(it.descripcion)}" placeholder="Descripción del producto"></td>
        <td><input type="number" min="0" step="any" data-item="cantidad" value="${esc(it.cantidad)}"></td>
        <td><input type="text" data-item="unidad" value="${esc(it.unidad)}" list="lista-unidades"></td>
        <td class="col-precio"><input type="number" min="0" step="any" data-item="precio" value="${esc(it.precio)}"></td>
        <td class="col-precio total-cell">${Exporter.fmtMoney(Exporter.num(it.cantidad) * Exporter.num(it.precio), mon)}</td>
        <td><button class="btn-icon" data-del-item title="Eliminar ítem">🗑️</button></td>
      </tr>`).join('');
    if (!$('#lista-unidades')) {
      const dl = document.createElement('datalist'); dl.id = 'lista-unidades';
      dl.innerHTML = ['UND', 'CAJA', 'KG', 'G', 'L', 'M', 'M2', 'PAR', 'PAQ', 'BULTO', 'GALÓN'].map(u => `<option value="${u}">`).join('');
      document.body.appendChild(dl);
    }
    $('#view-nueva').classList.toggle('hide-precios', config.remision.mostrarPrecios === false);
    renderTotals();
  }
  function renderTotals() {
    const t = Exporter.calcTotals(current, config), mon = config.remision.moneda;
    $('#t-subtotal').textContent = Exporter.fmtMoney(t.subtotal, mon);
    $('#t-iva').textContent = Exporter.fmtMoney(t.iva, mon);
    $('#t-total').textContent = Exporter.fmtMoney(t.total, mon);
  }
  $('#btn-add-item').addEventListener('click', () => {
    current.items.push(itemVacio()); renderItems(); renderPreview();
    const last = $$('#items-body tr').pop(); last && last.querySelector('[data-item="descripcion"]').focus();
  });
  $('#items-body').addEventListener('click', e => {
    const b = e.target.closest('[data-del-item]');
    if (!b) return;
    const idx = +b.closest('tr').dataset.idx;
    current.items.splice(idx, 1);
    if (!current.items.length) current.items.push(itemVacio());
    renderItems(); renderPreview();
  });
  // Enter en la última descripción agrega fila
  $('#items-body').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.dataset.item) {
      e.preventDefault();
      const tr = e.target.closest('tr');
      if (+tr.dataset.idx === current.items.length - 1) $('#btn-add-item').click();
      else tr.nextElementSibling.querySelector('[data-item="descripcion"]').focus();
    }
  });

  // ================= Vista previa =================
  function renderPreview() {
    const emp = config.empresa, mon = config.remision.moneda, precios = config.remision.mostrarPrecios !== false;
    const t = Exporter.calcTotals(current, config);
    const c = current.cliente || {}, e = current.entrega || {};
    const dl = rows => rows.filter(r => r[1]).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    const filas = t.items.map((it, i) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${esc(it.codigo)}</td>
        <td>${esc(it.descripcion) || '<span style="color:#9ca3af">—</span>'}</td>
        <td class="num">${Exporter.fmtQty(Exporter.num(it.cantidad))}</td>
        <td class="center">${esc(it.unidad)}</td>
        ${precios ? `<td class="num">${Exporter.fmtMoney(Exporter.num(it.precio), mon)}</td><td class="num">${Exporter.fmtMoney(it.total, mon)}</td>` : ''}
      </tr>`).join('');
    $('#doc').innerHTML = `
      <header class="doc-head">
        <div class="doc-emisor">
          ${emp.logo ? `<img class="doc-logo" src="${emp.logo}" alt="Logo">` : ''}
          <div>
            <h1>${esc(emp.nombre)}</h1>
            ${emp.nit ? `<p>NIT ${esc(emp.nit)}</p>` : ''}
            <p>${esc([emp.direccion, emp.ciudad].filter(Boolean).join(' · '))}</p>
            <p>${esc([emp.telefono, emp.email, emp.web].filter(Boolean).join(' · '))}</p>
          </div>
        </div>
        <div class="doc-num">
          <div class="doc-num-title">REMISIÓN</div>
          <div class="doc-num-value">${esc(current.numero)}</div>
          <div class="doc-num-meta"><span>Fecha</span><b>${Exporter.fmtDate(current.fecha)}</b></div>
          <div class="doc-num-meta"><span>Entrega</span><b>${Exporter.fmtDate(current.fechaEntrega) || '—'}</b></div>
          ${c.ordenCompra ? `<div class="doc-num-meta"><span>O. compra</span><b>${esc(c.ordenCompra)}</b></div>` : ''}
        </div>
      </header>
      <section class="doc-grid">
        <div class="doc-box"><h3>Cliente</h3><dl>${dl([['Nombre', c.nombre], ['NIT / CC', c.documento], ['Dirección', [c.direccion, c.ciudad].filter(Boolean).join(', ')], ['Teléfono', c.telefono], ['Correo', c.email], ['Orden de compra', c.ordenCompra]]) || '<dd style="color:#9ca3af">Sin datos</dd>'}</dl></div>
        <div class="doc-box"><h3>Entrega</h3><dl>${dl([['Dirección', [e.direccion, e.ciudad].filter(Boolean).join(', ')], ['Transportador', e.transportador], ['Placa', e.placa], ['Guía / Ref.', e.guia]]) || '<dd style="color:#9ca3af">Sin datos</dd>'}</dl></div>
      </section>
      <table class="doc-items">
        <thead><tr><th class="center">#</th><th>Código</th><th>Descripción</th><th class="num">Cant.</th><th class="center">Unidad</th>${precios ? '<th class="num">Vr. unitario</th><th class="num">Total</th>' : ''}</tr></thead>
        <tbody>${filas}</tbody>
      </table>
      ${precios ? `<div class="doc-totals"><table>
        <tr><td>Subtotal</td><td class="num">${Exporter.fmtMoney(t.subtotal, mon)}</td></tr>
        <tr><td>IVA ${t.pct}%</td><td class="num">${Exporter.fmtMoney(t.iva, mon)}</td></tr>
        <tr class="total"><td>TOTAL</td><td class="num">${Exporter.fmtMoney(t.total, mon)}</td></tr>
      </table></div>` : ''}
      ${current.observaciones ? `<div class="doc-section"><h3>Observaciones</h3><p>${esc(current.observaciones)}</p></div>` : ''}
      ${config.remision.notas ? `<div class="doc-section"><h3>Términos y condiciones</h3><p>${esc(config.remision.notas)}</p></div>` : ''}
      <div class="doc-firmas">
        <div class="doc-firma"><b>Entregado por</b><span>Nombre: ${esc(emp.responsable || emp.nombre)}<br>C.C.: ____________ &nbsp; Fecha: ____/____/______</span></div>
        <div class="doc-firma"><b>Recibido por</b><span>Nombre: ${esc(c.nombre) || '______________________'}<br>C.C.: ____________ &nbsp; Fecha: ____/____/______</span></div>
      </div>
      <div class="doc-foot">${esc(emp.nombre)} · Remisión ${esc(current.numero)}</div>`;
  }

  // ================= Guardar / acciones =================
  function validar() {
    const errores = [];
    if (!current.numero?.trim()) errores.push('el número');
    if (!current.cliente.nombre?.trim()) errores.push('el nombre del cliente');
    if (!current.items.some(it => it.descripcion?.trim())) errores.push('al menos un ítem con descripción');
    if (errores.length) { toast('Falta ' + errores.join(', ') + '.', 'error'); return false; }
    if (Storage.existsNumero(current.numero.trim(), current.id)) { toast(`Ya existe una remisión con el número ${current.numero}.`, 'error'); return false; }
    return true;
  }
  function guardar(silencioso) {
    if (!validar()) return false;
    current.numero = current.numero.trim();
    current.items = current.items.filter(it => it.descripcion?.trim() || it.codigo?.trim());
    if (current.estado === 'borrador') current.estado = 'guardada';
    Storage.save(current);
    if (esNueva) {
      // consume el consecutivo solo si el número coincide con el automático
      if (current.numero === Storage.nextNumber(config)) {
        config.remision.consecutivo = (parseInt(config.remision.consecutivo, 10) || 1) + 1;
        Storage.saveConfig(config);
      }
      esNueva = false;
    }
    renderItems(); actualizarEstadoEditor(); actualizarBadge();
    if (!silencioso) toast(`Remisión ${current.numero} guardada.`, 'ok');
    return true;
  }
  $('#btn-guardar').addEventListener('click', () => guardar());
  $('#btn-nueva').addEventListener('click', () => {
    if (esNueva && current.cliente.nombre && !confirm('La remisión actual no se ha guardado. ¿Crear una nueva de todos modos?')) return;
    cargar(nuevaRemision(), true);
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's' && !$('#view-nueva').classList.contains('hidden')) { e.preventDefault(); guardar(); }
  });

  // Antes de exportar se guarda para que el historial coincida con lo enviado
  function preparar() { return guardar(true); }

  $('#btn-imprimir').addEventListener('click', () => { if (preparar()) { renderPreview(); setTimeout(() => Exporter.print(), 50); } });
  $('#btn-pdf').addEventListener('click', () => { if (preparar()) Exporter.toPDF(current, config); });
  $('#btn-excel').addEventListener('click', () => { if (preparar()) Exporter.toExcel(current, config); });
  $('#btn-xml').addEventListener('click', () => { if (preparar()) Exporter.toXML(current, config); });

  // ================= WhatsApp =================
  function telefonoWA(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    const cp = String(config.whatsapp?.codigoPais || '').replace(/\D/g, '');
    if (cp && d.length <= 10 && !d.startsWith(cp)) d = cp + d;
    return d;
  }
  $('#btn-whatsapp').addEventListener('click', () => {
    if (!preparar()) return;
    const tel = telefonoWA(current.cliente.telefono);
    const msg = Exporter.plantilla(config.whatsapp?.mensaje, current, config);
    let tel2 = tel;
    if (!tel2) {
      const t = prompt('El cliente no tiene teléfono. Escribe el número de WhatsApp (con indicativo, ej. 573001234567):', '');
      if (t === null) return;
      tel2 = telefonoWA(t);
    }
    // Se descarga el PDF para que el usuario lo adjunte en el chat (WhatsApp no permite adjuntar por enlace)
    Exporter.toPDF(current, config);
    const url = `https://wa.me/${tel2}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener');
    marcarEnviada('whatsapp', tel2 ? '+' + tel2 : '');
    toast('Se abrió WhatsApp con el mensaje. Adjunta el PDF que se acaba de descargar.', 'ok');
  });

  function marcarEnviada(medio, para) {
    current.estado = 'enviada';
    (current.enviadoA = current.enviadoA || []).push({ medio, para, fecha: new Date().toISOString() });
    Storage.save(current); actualizarEstadoEditor();
  }

  // ================= Correo =================
  async function verificarCorreo() {
    try {
      const r = await fetch('/api/send-email', { method: 'GET' });
      const j = await r.json();
      emailConfigurado = !!j.configured;
    } catch (e) { emailConfigurado = false; }
    const pill = $('#email-status');
    pill.textContent = emailConfigurado ? 'Correo: envío directo activo' : 'Correo: modo demo (abre tu cliente de correo)';
    pill.className = 'pill ' + (emailConfigurado ? 'pill-ok' : 'pill-warn');
    $('#cfg-email-info').textContent = emailConfigurado
      ? 'Envío directo configurado en el servidor (Resend). Los correos salen con el PDF adjunto.'
      : 'Sin RESEND_API_KEY en Vercel: el botón "Enviar" descarga el PDF y abre tu cliente de correo con el mensaje listo. Configura RESEND_API_KEY y MAIL_FROM en Vercel para envío directo con adjunto.';
  }

  const modal = $('#modal-email');
  function abrirModal() {
    if (!preparar()) return;
    $('#em-para').value = current.cliente.email || '';
    $('#em-cc').value = config.correo.cc || '';
    $('#em-asunto').value = Exporter.plantilla(config.correo.asunto, current, config);
    $('#em-mensaje').value = Exporter.plantilla(config.correo.mensaje, current, config);
    $('#em-nota').textContent = emailConfigurado
      ? 'El correo se envía desde el servidor con el PDF adjunto.'
      : 'Modo demo: se descargará el PDF y se abrirá tu aplicación de correo con el mensaje; adjunta el PDF antes de enviar.';
    modal.classList.remove('hidden');
    $('#em-para').focus();
  }
  function cerrarModal() { modal.classList.add('hidden'); }
  $('#btn-email').addEventListener('click', abrirModal);
  modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) cerrarModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) cerrarModal(); });

  $('#em-enviar').addEventListener('click', async () => {
    const para = $('#em-para').value.trim(), cc = $('#em-cc').value.trim();
    const asunto = $('#em-asunto').value.trim(), mensaje = $('#em-mensaje').value;
    const adjuntar = $('#em-adjuntar').checked;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) { toast('Escribe un correo válido.', 'error'); return; }
    const btn = $('#em-enviar'); btn.disabled = true; btn.textContent = 'Enviando…';
    try {
      if (emailConfigurado) {
        const body = { to: para, cc, subject: asunto, message: mensaje };
        if (adjuntar) { body.filename = Exporter.fileName(current, 'pdf'); body.pdfBase64 = Exporter.pdfBase64(current, config); }
        const r = await fetch('/api/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || 'Error enviando el correo (' + r.status + ')');
        toast(`Correo enviado a ${para}.`, 'ok');
      } else {
        if (adjuntar) Exporter.toPDF(current, config);
        const href = `mailto:${encodeURIComponent(para)}?${cc ? 'cc=' + encodeURIComponent(cc) + '&' : ''}subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(mensaje)}`;
        window.location.href = href;
        toast('Se abrió tu cliente de correo. Adjunta el PDF descargado y envía.', 'ok');
      }
      marcarEnviada('correo', para);
      cerrarModal();
    } catch (err) {
      toast(err.message, 'error');
    } finally { btn.disabled = false; btn.textContent = '✉️ Enviar'; }
  });

  // ================= Historial =================
  function actualizarBadge() { $('#badge-historial').textContent = Storage.getAll().length; }
  function renderHistorial() {
    const q = ($('#hist-buscar').value || '').toLowerCase().trim();
    const est = $('#hist-estado').value;
    const mon = config.remision.moneda;
    let list = Storage.getAll();
    if (est) list = list.filter(r => r.estado === est);
    if (q) list = list.filter(r => [r.numero, r.cliente?.nombre, r.cliente?.documento, r.cliente?.ordenCompra, r.cliente?.ciudad, r.entrega?.ciudad].join(' ').toLowerCase().includes(q));
    const tb = $('#hist-body');
    tb.innerHTML = list.map(r => {
      const t = Exporter.calcTotals(r, config);
      const pill = r.estado === 'enviada' ? 'pill-ok' : 'pill-info';
      const envios = (r.enviadoA || []).map(x => `${x.medio}: ${x.para}`).join('\n');
      return `<tr data-id="${r.id}">
        <td><b>${esc(r.numero)}</b></td>
        <td>${Exporter.fmtDate(r.fecha)}</td>
        <td>${esc(r.cliente?.nombre)}<br><span class="muted">${esc(r.cliente?.documento)}</span></td>
        <td>${esc(r.cliente?.ordenCompra) || '<span class="muted">—</span>'}</td>
        <td>${esc(r.entrega?.ciudad || r.cliente?.ciudad)}</td>
        <td class="num">${t.items.length}</td>
        <td class="num">${config.remision.mostrarPrecios === false ? '—' : Exporter.fmtMoney(t.total, mon)}</td>
        <td><span class="pill ${pill}" title="${esc(envios)}">${r.estado === 'enviada' ? 'Enviada' : 'Guardada'}</span></td>
        <td class="actions">
          <button class="btn-icon" data-act="editar" title="Ver / editar">✏️</button>
          <button class="btn-icon" data-act="duplicar" title="Duplicar">📋</button>
          <button class="btn-icon" data-act="pdf" title="Descargar PDF">📄</button>
          <button class="btn-icon" data-act="excel" title="Descargar Excel">📊</button>
          <button class="btn-icon" data-act="xml" title="Descargar XML">🧾</button>
          <button class="btn-icon" data-act="eliminar" title="Eliminar">🗑️</button>
        </td>
      </tr>`;
    }).join('');
    $('#hist-vacio').classList.toggle('hidden', Storage.getAll().length > 0);
    const total = list.reduce((s, r) => s + Exporter.calcTotals(r, config).total, 0);
    $('#hist-resumen').textContent = list.length ? `${list.length} remisión(es)` + (config.remision.mostrarPrecios === false ? '' : ` · ${Exporter.fmtMoney(total, mon)}`) : '';
    actualizarBadge();
  }
  $('#hist-buscar').addEventListener('input', renderHistorial);
  $('#hist-estado').addEventListener('change', renderHistorial);
  $('#hist-body').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const id = b.closest('tr').dataset.id, r = Storage.get(id); if (!r) return;
    switch (b.dataset.act) {
      case 'editar': cargar(r, false); break;
      case 'duplicar': {
        const d = { ...JSON.parse(JSON.stringify(r)), id: uid(), numero: Storage.nextNumber(config), fecha: hoy(), fechaEntrega: '', estado: 'borrador', enviadoA: [], creadoEn: new Date().toISOString() };
        cargar(d, true); toast(`Copia de ${r.numero} creada como ${d.numero}.`); break;
      }
      case 'pdf': Exporter.toPDF(r, config); break;
      case 'excel': Exporter.toExcel(r, config); break;
      case 'xml': Exporter.toXML(r, config); break;
      case 'eliminar':
        if (confirm(`¿Eliminar la remisión ${r.numero}? Esta acción no se puede deshacer.`)) {
          Storage.remove(id); renderHistorial(); toast('Remisión eliminada.');
          if (current && current.id === id) cargar(nuevaRemision(), true);
        }
        break;
    }
  });
  $('#btn-hist-excel').addEventListener('click', () => {
    const list = Storage.getAll(); if (!list.length) { toast('No hay remisiones para exportar.', 'error'); return; }
    Exporter.toExcelAll(list, config);
  });
  $('#btn-backup').addEventListener('click', () => {
    Exporter.download(new Blob([Storage.exportJSON()], { type: 'application/json' }), `respaldo_remisiones_${hoy()}.json`);
  });
  $('#btn-restore').addEventListener('click', () => $('#file-restore').click());
  $('#file-restore').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const res = Storage.importJSON(await f.text());
      config = Storage.getConfig();
      toast(`Importadas ${res.nuevas} remisiones nuevas (${res.total} en total).`, 'ok');
      renderHistorial();
    } catch (err) { toast('No se pudo importar: ' + err.message, 'error'); }
    e.target.value = '';
  });

  // ================= Configuración =================
  function fillConfigForm() {
    $$('#view-config [data-cfg]').forEach(el => {
      const v = getPath(config, el.dataset.cfg);
      if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
    });
    const img = $('#cfg-logo-preview');
    img.src = config.empresa.logo || '';
    img.classList.toggle('hidden', !config.empresa.logo);
    $('#cfg-logo-empty').classList.toggle('hidden', !!config.empresa.logo);
  }
  $('#btn-cfg-guardar').addEventListener('click', () => {
    $$('#view-config [data-cfg]').forEach(el => {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.type === 'number') v = parseFloat(v) || 0;
      setPath(config, el.dataset.cfg, v);
    });
    if (!config.empresa.nombre.trim()) { toast('El nombre de la empresa es obligatorio.', 'error'); return; }
    config.remision.consecutivo = Math.max(1, parseInt(config.remision.consecutivo, 10) || 1);
    config.configurado = true;
    if (!Storage.saveConfig(config)) { toast('No se pudo guardar (¿logo demasiado grande?).', 'error'); return; }
    if (esNueva) current.numero = Storage.nextNumber(config);
    if (esNueva) current.aplicaIva = !!config.remision.aplicaIva;
    $('#brand-empresa').textContent = config.empresa.nombre;
    $('#banner-config').classList.add('hidden');
    fillForm(); renderItems(); renderPreview();
    toast('Configuración guardada.', 'ok');
  });
  $('#cfg-logo').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const img = new Image();
    img.onload = () => {
      const max = 480, k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      config.empresa.logo = cv.toDataURL(f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9);
      fillConfigForm(); renderPreview();
      toast('Logo cargado. Recuerda guardar la configuración.');
    };
    img.onerror = () => toast('No se pudo leer la imagen.', 'error');
    img.src = URL.createObjectURL(f);
    e.target.value = '';
  });
  $('#cfg-logo-quitar').addEventListener('click', () => { config.empresa.logo = ''; fillConfigForm(); renderPreview(); });
  $('#btn-cfg-demo').addEventListener('click', () => { cargar(remisionDemo(), true); toast('Remisión de ejemplo cargada (no guardada).'); });
  $('#btn-cfg-reset').addEventListener('click', () => {
    if (!confirm('Se borrará la configuración y TODO el historial de este navegador. ¿Continuar?')) return;
    Storage.clearAll(); localStorage.removeItem('remisiones.demo');
    location.reload();
  });

  // ================= Datos de demostración =================
  function remisionDemo() {
    const r = nuevaRemision();
    r.fechaEntrega = r.fecha;
    r.cliente = { nombre: 'Comercializadora El Roble S.A.S.', documento: '901.234.567-8', direccion: 'Cra 45 # 12 - 80, Bodega 3', ciudad: 'Medellín', telefono: '300 123 4567', email: 'compras@elroble.com', ordenCompra: 'OC-2026-0458' };
    r.entrega = { direccion: 'Cra 45 # 12 - 80, Bodega 3', ciudad: 'Medellín', transportador: 'Carlos Pérez', placa: 'ABC-123', guia: '' };
    r.items = [
      { codigo: 'PRD-001', descripcion: 'Caja de tornillos hexagonales 1/4" x 100 und', cantidad: 12, unidad: 'CAJA', precio: 38500 },
      { codigo: 'PRD-014', descripcion: 'Lámina galvanizada calibre 20 (1.20 x 2.40 m)', cantidad: 8, unidad: 'UND', precio: 96000 },
      { codigo: 'PRD-032', descripcion: 'Pintura anticorrosiva gris', cantidad: 4, unidad: 'GALÓN', precio: 72000 }
    ];
    r.observaciones = 'Entregar en horario de 8:00 a.m. a 4:00 p.m. Preguntar por el almacenista.';
    return r;
  }
  function sembrarDemo() {
    if (localStorage.getItem('remisiones.demo') || Storage.getAll().length) return;
    const base = new Date();
    const ejemplos = [
      { d: 12, cliente: { nombre: 'Ferretería La Central', documento: '800.555.111-2', direccion: 'Calle 10 # 5 - 20', ciudad: 'Cali', telefono: '315 555 0101', email: 'pedidos@lacentral.co', ordenCompra: 'OC-1001' },
        entrega: { direccion: 'Calle 10 # 5 - 20', ciudad: 'Cali', transportador: 'Envía', placa: '', guia: 'EN-77812' },
        items: [{ codigo: 'PRD-001', descripcion: 'Caja de tornillos hexagonales 1/4" x 100 und', cantidad: 20, unidad: 'CAJA', precio: 38500 }, { codigo: 'PRD-007', descripcion: 'Broca para concreto 3/8"', cantidad: 30, unidad: 'UND', precio: 8900 }],
        estado: 'enviada', enviadoA: [{ medio: 'correo', para: 'pedidos@lacentral.co' }] },
      { d: 6, cliente: { nombre: 'Constructora Andina Ltda.', documento: '860.222.333-4', direccion: 'Av. Boyacá # 80 - 15', ciudad: 'Bogotá D.C.', telefono: '310 200 3040', email: 'obra@andina.com', ordenCompra: 'OC-1017' },
        entrega: { direccion: 'Obra Torres del Parque, Calle 170 # 8 - 90', ciudad: 'Bogotá D.C.', transportador: 'Luis Gómez', placa: 'XYZ-789', guia: '' },
        items: [{ codigo: 'PRD-014', descripcion: 'Lámina galvanizada calibre 20 (1.20 x 2.40 m)', cantidad: 25, unidad: 'UND', precio: 96000 }, { codigo: 'PRD-032', descripcion: 'Pintura anticorrosiva gris', cantidad: 10, unidad: 'GALÓN', precio: 72000 }, { codigo: 'PRD-040', descripcion: 'Soldadura 6013 x 1/8"', cantidad: 15, unidad: 'KG', precio: 14500 }],
        estado: 'enviada', enviadoA: [{ medio: 'whatsapp', para: '+573102003040' }] },
      { d: 1, cliente: { nombre: 'Comercializadora El Roble S.A.S.', documento: '901.234.567-8', direccion: 'Cra 45 # 12 - 80, Bodega 3', ciudad: 'Medellín', telefono: '300 123 4567', email: 'compras@elroble.com', ordenCompra: 'OC-1025' },
        entrega: { direccion: 'Cra 45 # 12 - 80, Bodega 3', ciudad: 'Medellín', transportador: 'Carlos Pérez', placa: 'ABC-123', guia: '' },
        items: [{ codigo: 'PRD-021', descripcion: 'Cemento gris 50 kg', cantidad: 40, unidad: 'BULTO', precio: 31000 }],
        estado: 'guardada', enviadoA: [] }
    ];
    ejemplos.forEach(e => {
      const f = new Date(base); f.setDate(f.getDate() - e.d);
      const r = nuevaRemision();
      Object.assign(r, { fecha: isoLocal(f), fechaEntrega: isoLocal(f), cliente: e.cliente, entrega: e.entrega, items: e.items, estado: e.estado,
        enviadoA: e.enviadoA.map(x => ({ ...x, fecha: f.toISOString() })), creadoEn: f.toISOString(), observaciones: '' });
      Storage.save(r);
      config.remision.consecutivo = (parseInt(config.remision.consecutivo, 10) || 1) + 1;
    });
    Storage.saveConfig(config);
    localStorage.setItem('remisiones.demo', '1');
  }

  // ================= Inicio =================
  function init() {
    const hashInicial = location.hash.slice(1);
    sembrarDemo();
    $('#brand-empresa').textContent = config.empresa.nombre;
    $('#banner-config').classList.toggle('hidden', !!config.configurado);
    // Mientras no se configure la empresa, el editor arranca con una remisión de ejemplo
    cargar(config.configurado ? nuevaRemision() : remisionDemo(), true);
    actualizarBadge();
    verificarCorreo();
    const porHash = h => { if (['nueva', 'historial', 'config'].includes(h)) showView(h); };
    window.addEventListener('hashchange', () => porHash(location.hash.slice(1)));
    porHash(hashInicial);
  }
  init();
})();
