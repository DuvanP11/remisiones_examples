/* Almacenamiento local (localStorage): configuración e historial de remisiones. */
const Storage = (() => {
  const KEYS = { config: 'remisiones.config', lista: 'remisiones.lista' };

  const DEFAULT_CONFIG = {
    configurado: false,
    empresa: {
      nombre: 'Mi Empresa S.A.S.',
      nit: '900.123.456-7',
      direccion: 'Calle 100 # 20 - 30',
      ciudad: 'Bogotá D.C.',
      telefono: '(601) 555 0000',
      email: 'despachos@miempresa.com',
      web: 'www.miempresa.com',
      responsable: '',
      logo: ''
    },
    remision: {
      prefijo: 'REM',
      consecutivo: 1,
      iva: 19,
      moneda: 'COP',
      aplicaIva: true,
      mostrarPrecios: true,
      notas: 'Esta remisión no es una factura de venta. La mercancía viaja por cuenta y riesgo del comprador. ' +
             'Toda reclamación por faltantes o averías debe hacerse al momento de la entrega.'
    },
    whatsapp: {
      codigoPais: '57',
      mensaje: 'Hola {{cliente}}, le compartimos la remisión *{{numero}}* de {{empresa}} con fecha {{fecha}} por valor de {{total}}. ' +
               'Adjuntamos el PDF a continuación. Por favor confirmar la recepción. ¡Gracias!'
    },
    correo: {
      asunto: 'Remisión {{numero}} - {{empresa}}',
      mensaje: 'Buen día {{cliente}},\n\nAdjuntamos la remisión {{numero}} de fecha {{fecha}} por valor de {{total}}.\n\n' +
               'Por favor confirmar la recepción de la mercancía.\n\nCordialmente,\n{{empresa}}',
      cc: ''
    }
  };

  function deepMerge(base, extra) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    if (!extra || typeof extra !== 'object') return out;
    for (const k of Object.keys(extra)) {
      const v = extra[k];
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && !Array.isArray(base[k]))
        ? deepMerge(base[k], v) : v;
    }
    return out;
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('No se pudo leer', key, e);
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('No se pudo guardar', key, e);
      return false;
    }
  }

  // ---- Configuración
  function getConfig() {
    return deepMerge(DEFAULT_CONFIG, read(KEYS.config, null));
  }
  function saveConfig(cfg) {
    return write(KEYS.config, cfg);
  }
  function defaultConfig() {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
  function nextNumber(cfg) {
    const n = Math.max(1, parseInt(cfg.remision.consecutivo, 10) || 1);
    const pre = (cfg.remision.prefijo || '').trim();
    return (pre ? pre + '-' : '') + String(n).padStart(5, '0');
  }

  // ---- Remisiones
  function getAll() {
    const list = read(KEYS.lista, []);
    return Array.isArray(list) ? list.sort((a, b) => (b.creadoEn || '').localeCompare(a.creadoEn || '')) : [];
  }
  function get(id) {
    return getAll().find(r => r.id === id) || null;
  }
  function save(rem) {
    const list = read(KEYS.lista, []);
    const idx = list.findIndex(r => r.id === rem.id);
    rem.actualizadoEn = new Date().toISOString();
    if (idx >= 0) list[idx] = rem; else list.push(rem);
    return write(KEYS.lista, list);
  }
  function remove(id) {
    const list = read(KEYS.lista, []).filter(r => r.id !== id);
    return write(KEYS.lista, list);
  }
  function existsNumero(numero, exceptId) {
    return getAll().some(r => r.numero === numero && r.id !== exceptId);
  }
  function clientesConocidos() {
    const map = new Map();
    for (const r of getAll()) {
      const c = r.cliente || {};
      if (c.nombre && !map.has(c.nombre)) map.set(c.nombre, c);
    }
    return [...map.values()];
  }

  // ---- Respaldo
  function exportJSON() {
    return JSON.stringify({
      version: 1,
      exportadoEn: new Date().toISOString(),
      config: getConfig(),
      remisiones: getAll()
    }, null, 2);
  }
  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.remisiones)) throw new Error('El archivo no tiene el formato esperado.');
    const actuales = read(KEYS.lista, []);
    const ids = new Set(actuales.map(r => r.id));
    let nuevas = 0;
    for (const r of data.remisiones) {
      if (r && r.id && !ids.has(r.id)) { actuales.push(r); nuevas++; }
    }
    write(KEYS.lista, actuales);
    if (data.config) write(KEYS.config, deepMerge(getConfig(), data.config));
    return { nuevas, total: actuales.length };
  }
  function clearAll() {
    localStorage.removeItem(KEYS.config);
    localStorage.removeItem(KEYS.lista);
  }

  return { getConfig, saveConfig, defaultConfig, nextNumber, getAll, get, save, remove, existsNumero,
           clientesConocidos, exportJSON, importJSON, clearAll };
})();
