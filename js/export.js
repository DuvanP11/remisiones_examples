/* Exportación: cálculos, formato, PDF (jsPDF + autotable), Excel (SheetJS), XML e impresión. */
const Exporter = (() => {

  // ---------- Utilidades ----------
  function num(v) { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? 0 : n; }

  function fmtMoney(n, moneda) {
    try {
      return new Intl.NumberFormat('es-CO', { style: 'currency', currency: moneda || 'COP', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n || 0);
    } catch (e) {
      return (moneda || '') + ' ' + (n || 0).toLocaleString('es-CO');
    }
  }
  function fmtQty(n) { return (n || 0).toLocaleString('es-CO', { maximumFractionDigits: 3 }); }
  function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return (y && m && d) ? `${d}/${m}/${y}` : iso;
  }

  function calcTotals(rem, cfg) {
    const items = (rem.items || []).map(it => ({ ...it, total: num(it.cantidad) * num(it.precio) }));
    const subtotal = items.reduce((s, it) => s + it.total, 0);
    const pct = rem.aplicaIva ? num(cfg.remision.iva) : 0;
    const iva = Math.round(subtotal * pct) / 100;
    return { items, subtotal, pct, iva, total: subtotal + iva };
  }

  function safeName(s) { return String(s || '').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 40); }
  function fileName(rem, ext) {
    return `Remision_${safeName(rem.numero) || 'sin-numero'}${rem.cliente?.nombre ? '_' + safeName(rem.cliente.nombre) : ''}.${ext}`;
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
  function plantilla(texto, rem, cfg) {
    const t = calcTotals(rem, cfg);
    return String(texto || '')
      .replace(/{{\s*numero\s*}}/gi, rem.numero || '')
      .replace(/{{\s*cliente\s*}}/gi, rem.cliente?.nombre || '')
      .replace(/{{\s*empresa\s*}}/gi, cfg.empresa.nombre || '')
      .replace(/{{\s*fecha\s*}}/gi, fmtDate(rem.fecha))
      .replace(/{{\s*total\s*}}/gi, fmtMoney(t.total, cfg.remision.moneda));
  }

  // ---------- PDF ----------
  function buildPDF(rem, cfg) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210, M = 14, CW = W - 2 * M;
    const emp = cfg.empresa, mon = cfg.remision.moneda, precios = cfg.remision.mostrarPrecios !== false;
    const t = calcTotals(rem, cfg);
    const GRAY = [107, 114, 128], DARK = [17, 24, 39], LINE = [209, 213, 219];
    let y = M;

    // Encabezado: logo + empresa
    let x = M;
    if (emp.logo) {
      try {
        const fmt = /^data:image\/png/i.test(emp.logo) ? 'PNG' : 'JPEG';
        const props = doc.getImageProperties(emp.logo);
        const h = 18, w = Math.min(36, h * props.width / props.height);
        doc.addImage(emp.logo, fmt, x, y, w, h, undefined, 'FAST');
        x += w + 5;
      } catch (e) { console.warn('Logo no se pudo agregar al PDF', e); }
    }
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...DARK);
    doc.text(emp.nombre || '', x, y + 5, { maxWidth: 100 });
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(55, 65, 81);
    const lineasEmp = [
      emp.nit ? `NIT ${emp.nit}` : '',
      [emp.direccion, emp.ciudad].filter(Boolean).join(' · '),
      [emp.telefono, emp.email, emp.web].filter(Boolean).join(' · ')
    ].filter(Boolean);
    let ye = y + 10;
    for (const l of lineasEmp) { doc.text(l, x, ye, { maxWidth: 105 }); ye += 4; }

    // Caja número
    const c = rem.cliente || {}, e = rem.entrega || {};
    const bw = 62, bx = W - M - bw, bh = c.ordenCompra ? 28.5 : 24;
    doc.setDrawColor(...DARK).setLineWidth(0.4).roundedRect(bx, y, bw, bh, 1.5, 1.5);
    doc.setFontSize(8).setTextColor(...GRAY).text('REMISIÓN', bx + bw - 3, y + 5, { align: 'right' });
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...DARK).text(rem.numero || '', bx + bw - 3, y + 11, { align: 'right' });
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.setTextColor(...GRAY).text('Fecha', bx + 3, y + 16.5);
    doc.setTextColor(...DARK).text(fmtDate(rem.fecha), bx + bw - 3, y + 16.5, { align: 'right' });
    doc.setTextColor(...GRAY).text('Entrega', bx + 3, y + 21);
    doc.setTextColor(...DARK).text(fmtDate(rem.fechaEntrega) || '—', bx + bw - 3, y + 21, { align: 'right' });
    if (c.ordenCompra) {
      doc.setTextColor(...GRAY).text('O. compra', bx + 3, y + 25.5);
      doc.setTextColor(...DARK).text(String(c.ordenCompra), bx + bw - 3, y + 25.5, { align: 'right', maxWidth: bw - 22 });
    }

    y = Math.max(ye, y + bh) + 3;
    doc.setDrawColor(...DARK).setLineWidth(0.6).line(M, y, W - M, y);
    y += 5;

    // Cajas cliente / entrega
    const boxes = [
      ['CLIENTE', [['Nombre', c.nombre], ['NIT / CC', c.documento], ['Dirección', [c.direccion, c.ciudad].filter(Boolean).join(', ')], ['Teléfono', c.telefono], ['Correo', c.email], ['Orden de compra', c.ordenCompra]]],
      ['ENTREGA', [['Dirección', [e.direccion, e.ciudad].filter(Boolean).join(', ')], ['Transportador', e.transportador], ['Placa', e.placa], ['Guía / Ref.', e.guia]]]
    ];
    const bwid = (CW - 4) / 2;
    let maxH = 0;
    boxes.forEach(([title, rows], i) => {
      const bx0 = M + i * (bwid + 4);
      const filas = rows.filter(r => r[1]);
      let yy = y + 5;
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY).text(title, bx0 + 3, yy);
      yy += 4.5;
      doc.setFont('helvetica', 'normal').setFontSize(8.5);
      for (const [k, v] of filas) {
        doc.setTextColor(...GRAY).text(k, bx0 + 3, yy);
        doc.setTextColor(...DARK);
        const lines = doc.splitTextToSize(String(v), bwid - 34);
        doc.text(lines, bx0 + 30, yy);
        yy += 4 * lines.length;
      }
      const h = Math.max(yy - y, 14);
      maxH = Math.max(maxH, h);
      doc.setDrawColor(...LINE).setLineWidth(0.3).roundedRect(bx0, y, bwid, h, 1.2, 1.2);
    });
    // Reencuadrar ambas cajas con la misma altura
    boxes.forEach((_, i) => {
      const bx0 = M + i * (bwid + 4);
      doc.setDrawColor(...LINE).setLineWidth(0.3).roundedRect(bx0, y, bwid, maxH, 1.2, 1.2);
    });
    y += maxH + 5;

    // Tabla de ítems
    const head = precios
      ? [['#', 'Código', 'Descripción', 'Cant.', 'Unidad', 'Vr. unitario', 'Total']]
      : [['#', 'Código', 'Descripción', 'Cant.', 'Unidad']];
    const body = t.items.map((it, i) => precios
      ? [i + 1, it.codigo || '', it.descripcion || '', fmtQty(num(it.cantidad)), it.unidad || '', fmtMoney(num(it.precio), mon), fmtMoney(it.total, mon)]
      : [i + 1, it.codigo || '', it.descripcion || '', fmtQty(num(it.cantidad)), it.unidad || '']);
    const colStyles = precios
      ? { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 24 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 16, halign: 'center' }, 5: { cellWidth: 26, halign: 'right' }, 6: { cellWidth: 28, halign: 'right' } }
      : { 0: { cellWidth: 8, halign: 'center' }, 1: { cellWidth: 30 }, 3: { cellWidth: 22, halign: 'right' }, 4: { cellWidth: 24, halign: 'center' } };
    doc.autoTable({
      startY: y, head, body, margin: { left: M, right: M }, theme: 'grid',
      styles: { fontSize: 8.5, cellPadding: 2, textColor: DARK, lineColor: LINE, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: [31, 41, 55], textColor: 255, fontStyle: 'bold', halign: 'left' },
      columnStyles: colStyles,
      didParseCell: d => { if (d.section === 'head' && colStyles[d.column.index]?.halign) d.cell.styles.halign = colStyles[d.column.index].halign; }
    });
    y = doc.lastAutoTable.finalY + 4;

    const ensure = (h) => { if (y + h > 297 - M - 10) { doc.addPage(); y = M; } };

    // Totales
    if (precios) {
      ensure(24);
      const tx = W - M, lx = W - M - 60;
      doc.setFontSize(9).setFont('helvetica', 'normal');
      doc.setTextColor(...GRAY).text('Subtotal', lx, y + 4); doc.setTextColor(...DARK).text(fmtMoney(t.subtotal, mon), tx, y + 4, { align: 'right' });
      doc.setTextColor(...GRAY).text(`IVA ${t.pct}%`, lx, y + 9); doc.setTextColor(...DARK).text(fmtMoney(t.iva, mon), tx, y + 9, { align: 'right' });
      doc.setDrawColor(...DARK).setLineWidth(0.5).line(lx, y + 11.5, tx, y + 11.5);
      doc.setFont('helvetica', 'bold').setFontSize(10.5);
      doc.text('TOTAL', lx, y + 17); doc.text(fmtMoney(t.total, mon), tx, y + 17, { align: 'right' });
      y += 24;
    }

    // Observaciones / notas
    const seccion = (titulo, texto) => {
      if (!texto) return;
      const lines = doc.splitTextToSize(String(texto), CW);
      ensure(8 + lines.length * 3.8);
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...GRAY).text(titulo, M, y);
      doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(31, 41, 55).text(lines, M, y + 4);
      y += 6 + lines.length * 3.8;
    };
    seccion('OBSERVACIONES', rem.observaciones);
    seccion('TÉRMINOS Y CONDICIONES', cfg.remision.notas);

    // Firmas
    ensure(30);
    y += 16;
    const fw = (CW - 20) / 2;
    [['Entregado por', emp.responsable || emp.nombre], ['Recibido por', c.nombre]].forEach(([lab, nombre], i) => {
      const fx = M + i * (fw + 20);
      doc.setDrawColor(...DARK).setLineWidth(0.3).line(fx, y, fx + fw, y);
      doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(...DARK).text(lab, fx, y + 4);
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...GRAY);
      doc.text(`Nombre: ${nombre || '______________________'}`, fx, y + 8.5);
      doc.text('C.C.: ____________________   Fecha: ____ / ____ / ______', fx, y + 12.5);
    });

    // Pie de página
    const pages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(156, 163, 175);
      doc.text(`${emp.nombre || ''} · Remisión ${rem.numero || ''}`, M, 297 - 8);
      doc.text(`Página ${p} de ${pages}`, W - M, 297 - 8, { align: 'right' });
    }
    return doc;
  }

  function toPDF(rem, cfg) { buildPDF(rem, cfg).save(fileName(rem, 'pdf')); }
  function pdfBase64(rem, cfg) {
    const uri = buildPDF(rem, cfg).output('datauristring');
    return uri.slice(uri.indexOf(',') + 1);
  }

  // ---------- Excel ----------
  function hojaRemision(rem, cfg) {
    const t = calcTotals(rem, cfg), emp = cfg.empresa, mon = cfg.remision.moneda;
    const precios = cfg.remision.mostrarPrecios !== false;
    const c = rem.cliente || {}, e = rem.entrega || {};
    const aoa = [
      [emp.nombre], [emp.nit ? `NIT ${emp.nit}` : ''], [[emp.direccion, emp.ciudad].filter(Boolean).join(' · ')], [[emp.telefono, emp.email].filter(Boolean).join(' · ')],
      [],
      ['REMISIÓN', rem.numero], ['Fecha', fmtDate(rem.fecha)], ['Fecha de entrega', fmtDate(rem.fechaEntrega)], ['Estado', rem.estado || ''],
      [],
      ['CLIENTE'], ['Nombre', c.nombre], ['NIT / CC', c.documento], ['Dirección', c.direccion], ['Ciudad', c.ciudad], ['Teléfono', c.telefono], ['Correo', c.email], ['Orden de compra', c.ordenCompra],
      [],
      ['ENTREGA'], ['Dirección', e.direccion], ['Ciudad', e.ciudad], ['Transportador', e.transportador], ['Placa', e.placa], ['Guía / Ref.', e.guia],
      [],
      precios ? ['#', 'Código', 'Descripción', 'Cantidad', 'Unidad', `Vr. unitario (${mon})`, `Total (${mon})`] : ['#', 'Código', 'Descripción', 'Cantidad', 'Unidad']
    ];
    t.items.forEach((it, i) => aoa.push(precios
      ? [i + 1, it.codigo || '', it.descripcion || '', num(it.cantidad), it.unidad || '', num(it.precio), it.total]
      : [i + 1, it.codigo || '', it.descripcion || '', num(it.cantidad), it.unidad || '']));
    if (precios) {
      aoa.push([], ['', '', '', '', '', 'Subtotal', t.subtotal], ['', '', '', '', '', `IVA ${t.pct}%`, t.iva], ['', '', '', '', '', 'TOTAL', t.total]);
    }
    aoa.push([], ['Observaciones', rem.observaciones || ''], ['Términos', cfg.remision.notas || '']);
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 44 }, { wch: 10 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
    return ws;
  }
  function toExcel(rem, cfg) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, hojaRemision(rem, cfg), 'Remisión');
    XLSX.writeFile(wb, fileName(rem, 'xlsx'));
  }
  function toExcelAll(list, cfg) {
    const mon = cfg.remision.moneda;
    const resumen = [['Número', 'Fecha', 'Fecha entrega', 'Cliente', 'NIT / CC', 'Orden de compra', 'Ciudad', 'Correo', 'Ítems', `Subtotal (${mon})`, `IVA (${mon})`, `Total (${mon})`, 'Estado', 'Enviada a', 'Creada']];
    const detalle = [['Número', 'Fecha', 'Cliente', '#', 'Código', 'Descripción', 'Cantidad', 'Unidad', `Vr. unitario (${mon})`, `Total (${mon})`]];
    for (const r of list) {
      const t = calcTotals(r, cfg);
      resumen.push([r.numero, fmtDate(r.fecha), fmtDate(r.fechaEntrega), r.cliente?.nombre || '', r.cliente?.documento || '', r.cliente?.ordenCompra || '', r.cliente?.ciudad || '', r.cliente?.email || '',
        t.items.length, t.subtotal, t.iva, t.total, r.estado || '', (r.enviadoA || []).map(x => x.para).join(', '), (r.creadoEn || '').slice(0, 10)]);
      t.items.forEach((it, i) => detalle.push([r.numero, fmtDate(r.fecha), r.cliente?.nombre || '', i + 1, it.codigo || '', it.descripcion || '', num(it.cantidad), it.unidad || '', num(it.precio), it.total]));
    }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(resumen); ws1['!cols'] = [12, 11, 12, 30, 16, 16, 14, 26, 6, 14, 12, 14, 10, 30, 11].map(w => ({ wch: w }));
    const ws2 = XLSX.utils.aoa_to_sheet(detalle); ws2['!cols'] = [12, 11, 30, 4, 14, 44, 10, 8, 14, 14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws1, 'Remisiones');
    XLSX.utils.book_append_sheet(wb, ws2, 'Detalle');
    XLSX.writeFile(wb, `Historial_remisiones_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  // ---------- XML ----------
  function xmlEsc(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function toXMLString(rem, cfg) {
    const t = calcTotals(rem, cfg), emp = cfg.empresa, c = rem.cliente || {}, e = rem.entrega || {};
    const tag = (n, v, ind = '    ') => `${ind}<${n}>${xmlEsc(v)}</${n}>\n`;
    let x = '<?xml version="1.0" encoding="UTF-8"?>\n';
    x += `<remision numero="${xmlEsc(rem.numero)}" fecha="${xmlEsc(rem.fecha)}" fechaEntrega="${xmlEsc(rem.fechaEntrega)}" estado="${xmlEsc(rem.estado || '')}">\n`;
    x += '  <emisor>\n' + tag('nombre', emp.nombre) + tag('nit', emp.nit) + tag('direccion', emp.direccion) + tag('ciudad', emp.ciudad) + tag('telefono', emp.telefono) + tag('email', emp.email) + '  </emisor>\n';
    x += '  <cliente>\n' + tag('nombre', c.nombre) + tag('documento', c.documento) + tag('direccion', c.direccion) + tag('ciudad', c.ciudad) + tag('telefono', c.telefono) + tag('email', c.email) + tag('ordenCompra', c.ordenCompra) + '  </cliente>\n';
    x += '  <entrega>\n' + tag('direccion', e.direccion) + tag('ciudad', e.ciudad) + tag('transportador', e.transportador) + tag('placa', e.placa) + tag('guia', e.guia) + '  </entrega>\n';
    x += '  <items>\n';
    t.items.forEach((it, i) => {
      x += `    <item numero="${i + 1}">\n` + tag('codigo', it.codigo, '      ') + tag('descripcion', it.descripcion, '      ') + tag('cantidad', num(it.cantidad), '      ') +
           tag('unidad', it.unidad, '      ') + tag('precioUnitario', num(it.precio), '      ') + tag('total', it.total, '      ') + '    </item>\n';
    });
    x += '  </items>\n';
    x += `  <totales moneda="${xmlEsc(cfg.remision.moneda)}">\n` + tag('subtotal', t.subtotal) + `    <iva porcentaje="${t.pct}">${t.iva}</iva>\n` + tag('total', t.total) + '  </totales>\n';
    x += tag('observaciones', rem.observaciones, '  ') + tag('terminos', cfg.remision.notas, '  ');
    x += '</remision>\n';
    return x;
  }
  function toXML(rem, cfg) {
    download(new Blob([toXMLString(rem, cfg)], { type: 'application/xml;charset=utf-8' }), fileName(rem, 'xml'));
  }

  // ---------- Impresión ----------
  function print() { window.print(); }

  return { num, fmtMoney, fmtQty, fmtDate, calcTotals, fileName, download, plantilla,
           buildPDF, toPDF, pdfBase64, toExcel, toExcelAll, toXMLString, toXML, print };
})();
