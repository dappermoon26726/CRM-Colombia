// ==UserScript==
// @name         Sistema Dual Independiente: Cronómetros + Respuestas Premium + Módulo Llamadas (Optimizado + Marco Seguro)
// @namespace    http://platatimer
// @version      84.11.5
// @description  Cronómetros, respuestas, llamadas y sincronización. Edición sin asistencia de escritura.
// @author       Aldair Valdivia
// @match        *://crm.co-prime.diftech.org/*
// @updateURL    https://github.com/dappermoon26726/CRM-Colombia/raw/refs/heads/main/colombia.user.js
// @downloadURL  https://github.com/dappermoon26726/CRM-Colombia/raw/refs/heads/main/colombia.user.js
// @require      https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js
// @require      https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js
// @require      https://accounts.google.com/gsi/client
// @run-at       document-start
// ==/UserScript==

/* jshint esversion: 11 */

(function() {
    'use strict';

    const ES_CRM = location.hostname === 'crm.co-prime.diftech.org';
    const MODO_VENTANA_AUTH = ES_CRM && new URLSearchParams(location.search).get('sistema_dual_auth') === '1';
    const SUITE_VERSION = '84.11.5';
    const SUITE_NOMBRE = 'Sistema Dual';
    const SUITE_AUTOR = 'Aldair Valdivia';

    // La ruta auxiliar conserva el mismo origen del CRM para compartir la sesión,
    // pero detiene la aplicación antes de que llegue a mostrar una segunda copia.
    if (MODO_VENTANA_AUTH) {
        try {
            window.stop();
            document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acceso · Sistema Dual</title></head><body></body>';
        } catch (error) {
            console.warn('[Sistema Dual] No fue posible preparar la ventana de acceso:', error);
        }
    }

    if (window.plataSuiteCargada) return;
    window.plataSuiteCargada = true;

    const limpiarResiduos = () => {
        ["reloj-automatico-plata", "panel-cronometros-plata", "ventana-respuestas-plata", "ventana-kb-plata", "estilo-alerta-plata", "modal-editor-scripts-plata", "modal-bienvenida-apodo-plata", "btn-toggle-modo-llamadas", "panel-bloc-notas-llamadas", "btn-emergencia-chats-plata", "panel-emergencia-chats-plata", "explosion-tema-plata", "suite-paleta-comandos", "suite-llamadas-pendientes", "suite-toast-plata", "suite-login-google-plata", "suite-estado-arranque-plata", "suite-noticia-editor"].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.remove();
        });
        document.querySelectorAll('.explosion-tema-panel-plata,.vista-previa-tema-panel-plata').forEach(el => el.remove());
    };
    limpiarResiduos();

    // =========================================================================
    // CONFIGURACIÓN DE FIREBASE Y DETECTOR DE IDENTIDAD DEL AGENTE
    // =========================================================================
    const FIREBASE_CONFIG = {
        apiKey: "AIzaSyDQX1Zkzd5bMWazr3FTyvoqWT9wUdXwQtk",
        databaseURL: "https://crm-scripts-agentes-1-default-rtdb.firebaseio.com",
        projectId: "crm-scripts-agentes-1",
        storageBucket: "crm-scripts-agentes-1.firebasestorage.app",
        messagingSenderId: "1047152112901",
        appId: "1:1047152112901:web:f6ba3269c837c2d886336c",
        measurementId: "G-GDHJYESLZJ"
    };

    const GOOGLE_OAUTH_CLIENT_ID = '1047152112901-50fm4o3e6hfvope812l5jphf72skf13p.apps.googleusercontent.com';
    const DOMINIOS_EMPRESA = ['dif.tech', 'plata.work'];
    const NOTICIAS_ADMIN_EMAIL = 'aldair.nequis@plata.work';

    const CLOUD_CONFIG = {
        FIREBASE_URL: FIREBASE_CONFIG.databaseURL,
        TIMEOUT_MS: 8000
    };

    const FETCH_CON_TIMEOUT = async (url, opciones = {}, timeoutMs = CLOUD_CONFIG.TIMEOUT_MS) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            return await fetch(url, { ...opciones, signal: controller.signal });
        } finally {
            clearTimeout(timeoutId);
        }
    };

    // =========================================================================
    // ACTUALIZADOR HÍBRIDO
    // Comprueba un archivo de metadatos ligero al iniciar y cada 15 minutos.
    // La instalación continúa bajo el control de Tampermonkey y nunca bloquea
    // el CRM, los cronómetros ni el trabajo del agente.
    // =========================================================================
    const ACTUALIZADOR_SUITE = {
        URL_METADATA: 'https://raw.githubusercontent.com/dappermoon26726/CRM-Colombia/main/colombia.user.js',
        URL_DESCARGA: 'https://raw.githubusercontent.com/dappermoon26726/CRM-Colombia/main/colombia.user.js',
        INTERVALO_MS: 15 * 60 * 1000,
        comprobando: false,
        disponible: false,
        versionRemota: '',
        modo: 'recomendada',
        ultimoError: '',
        ultimaComprobacion: 0,
        temporizador: null,

        compararVersiones(a, b) {
            const partesA = String(a || '').split('.').map(valor => parseInt(valor, 10) || 0);
            const partesB = String(b || '').split('.').map(valor => parseInt(valor, 10) || 0);
            const longitud = Math.max(partesA.length, partesB.length);
            for (let i = 0; i < longitud; i++) {
                const diferencia = (partesA[i] || 0) - (partesB[i] || 0);
                if (diferencia !== 0) return diferencia;
            }
            return 0;
        },

        extraerMetadata(texto) {
            const fuente = String(texto || '').slice(0, 12000);
            if (!fuente.includes('// ==UserScript==') || !/@namespace\s+http:\/\/platatimer\b/.test(fuente)) {
                throw new Error('El archivo de versión no pertenece a Sistema Dual.');
            }
            const version = fuente.match(/^\/\/\s*@version\s+([^\s]+)\s*$/mi)?.[1] || '';
            const modo = fuente.match(/^\/\/\s*@sdUpdateMode\s+(recomendada|obligatoria)\s*$/mi)?.[1]?.toLowerCase() || 'recomendada';
            if (!/^\d+(?:\.\d+){1,3}$/.test(version)) throw new Error('No se encontró una versión válida.');
            return { version, modo };
        },

        resumen() {
            if (this.comprobando) return { estado:'Comprobando actualización…', detalle:'Consultando la versión publicada.', accion:'Comprobando…' };
            if (this.disponible) {
                return {
                    estado:`Actualización ${this.versionRemota} disponible`,
                    detalle:this.modo === 'obligatoria'
                        ? 'Actualización operativa necesaria. El CRM seguirá disponible mientras la instalas.'
                        : 'Hay una versión recomendada lista para instalar.',
                    accion:'Actualizar ahora'
                };
            }
            if (this.ultimoError) return { estado:'No se pudo comprobar', detalle:'La herramienta volverá a intentarlo automáticamente.', accion:'Reintentar' };
            return { estado:`Sistema Dual ${SUITE_VERSION}`, detalle:'La herramienta comprobará nuevas versiones cada 15 minutos.', accion:'Comprobar' };
        },

        actualizarInterfaz() {
            if (typeof UI_MANAGER !== 'undefined' && typeof UI_MANAGER.actualizarAvisoActualizacion === 'function') {
                UI_MANAGER.actualizarAvisoActualizacion();
            }
        },

        async comprobar(forzar = false) {
            if (this.comprobando || navigator.onLine === false) {
                if (forzar && navigator.onLine === false && typeof UI_MANAGER !== 'undefined') UI_MANAGER.mostrarToast('Sin conexión para comprobar actualizaciones');
                return false;
            }
            this.comprobando = true;
            this.ultimoError = '';
            this.actualizarInterfaz();
            try {
                const separador = this.URL_METADATA.includes('?') ? '&' : '?';
                const respuesta = await FETCH_CON_TIMEOUT(`${this.URL_METADATA}${separador}sd_check=${Date.now()}`, {
                    method:'GET',
                    cache:'no-store',
                    credentials:'omit',
                    headers:{ 'Accept':'text/plain' }
                }, 10000);
                if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
                const metadata = this.extraerMetadata(await respuesta.text());
                this.versionRemota = metadata.version;
                this.modo = metadata.modo;
                this.disponible = this.compararVersiones(metadata.version, SUITE_VERSION) > 0;
                this.ultimaComprobacion = Date.now();
                if (this.disponible) {
                    const claveAviso = `suite_actualizacion_avisada_${metadata.version}`;
                    if (sessionStorage.getItem(claveAviso) !== '1' && typeof UI_MANAGER !== 'undefined') {
                        sessionStorage.setItem(claveAviso, '1');
                        UI_MANAGER.mostrarToast(`Actualización ${metadata.version} disponible`);
                    }
                } else if (forzar && typeof UI_MANAGER !== 'undefined') {
                    UI_MANAGER.mostrarToast('Ya tienes la versión más reciente');
                }
                return this.disponible;
            } catch (error) {
                this.ultimoError = error?.message || 'Error de conexión';
                if (forzar && typeof UI_MANAGER !== 'undefined') UI_MANAGER.mostrarToast('No se pudo comprobar la actualización');
                return false;
            } finally {
                this.comprobando = false;
                this.actualizarInterfaz();
            }
        },

        abrirActualizacion() {
            if (!this.disponible) return this.comprobar(true);
            const enlace = document.createElement('a');
            const separador = this.URL_DESCARGA.includes('?') ? '&' : '?';
            enlace.href = `${this.URL_DESCARGA}${separador}sd_install=${encodeURIComponent(this.versionRemota)}&t=${Date.now()}`;
            enlace.target = '_blank';
            enlace.rel = 'noopener noreferrer';
            enlace.style.display = 'none';
            document.body.appendChild(enlace);
            enlace.click();
            enlace.remove();
            if (typeof UI_MANAGER !== 'undefined') UI_MANAGER.mostrarToast('Confirma la actualización en la pestaña nueva');
            return true;
        },

        iniciar() {
            setTimeout(() => this.comprobar(false), 2500);
            if (!this.temporizador) this.temporizador = setInterval(() => this.comprobar(false), this.INTERVALO_MS);
        }
    };

    const AUTH_MANAGER = {
        sdk: null,
        auth: null,
        usuario: null,
        resolverAcceso: null,
        iniciando: false,
        cancelarVigilancia: null,
        perfilSincronizado: false,
        reintentoPerfil: null,
        accesoMinimizado: false,
        receptorVentanaActivo: false,
        canalAcceso: null,
        ventanaAcceso: null,
        monitorVentana: null,
        sesionVisualLocal: null,

        obtenerSesionVisualLocal() {
            if (this.sesionVisualLocal) return this.sesionVisualLocal;
            try {
                const sesion = JSON.parse(localStorage.getItem('suite_ultima_sesion_verificada_v1') || 'null');
                if (!sesion?.uid || !sesion?.email || !DOMINIOS_EMPRESA.includes(this.obtenerDominio(sesion.email))) return null;
                this.sesionVisualLocal = sesion;
                return sesion;
            } catch (_) {
                return null;
            }
        },

        recordarSesionVisual(usuario) {
            if (!this.cuentaPermitida(usuario)) return;
            const sesion = {
                uid: String(usuario.uid || ''),
                email: String(usuario.email || '').trim().toLowerCase(),
                displayName: usuario.displayName || '',
                verificadaEn: new Date().toISOString()
            };
            this.sesionVisualLocal = sesion;
            try { localStorage.setItem('suite_ultima_sesion_verificada_v1', JSON.stringify(sesion)); } catch (_) {}
        },

        olvidarSesionVisual() {
            this.sesionVisualLocal = null;
            try { localStorage.removeItem('suite_ultima_sesion_verificada_v1'); } catch (_) {}
        },

        obtenerDominio(email) {
            return String(email || '').trim().toLowerCase().split('@').pop();
        },

        cuentaPermitida(usuario) {
            if (!usuario || !usuario.email || usuario.emailVerified !== true) return false;
            return DOMINIOS_EMPRESA.includes(this.obtenerDominio(usuario.email));
        },

        mensajeError(error) {
            const codigo = String(error?.code || '');
            if (codigo.includes('popup-closed-by-user')) return 'Se cerró la ventana antes de completar el acceso.';
            if (codigo.includes('popup-blocked')) return 'Chrome bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo otra vez.';
            if (codigo.includes('popup-timeout')) return 'La ventana de acceso no respondió. Ciérrala y vuelve a intentarlo.';
            if (codigo.includes('credential-timeout')) return 'Google validó la cuenta, pero Firebase no respondió. Revisa el acceso a identitytoolkit.googleapis.com.';
            if (codigo.includes('invalid-credential')) return 'Google entregó una credencial inválida o vencida. Selecciona nuevamente la cuenta.';
            if (codigo.includes('account-exists-with-different-credential')) return 'El correo ya está vinculado mediante otro método de acceso en Firebase.';
            if (codigo.includes('unauthorized-domain')) return 'El dominio del CRM todavía no está autorizado en Firebase Authentication.';
            if (codigo.includes('operation-not-allowed')) return 'El proveedor Google todavía no está habilitado en Firebase Authentication.';
            if (codigo.includes('network-request-failed')) return 'No fue posible conectar con Google. Revisa la red e inténtalo otra vez.';
            return error?.message || 'No fue posible iniciar sesión.';
        },

        conTiempoLimite(promesa, milisegundos, codigo = 'suite/popup-timeout') {
            let temporizador;
            const limite = new Promise((_, rechazar) => {
                temporizador = setTimeout(() => {
                    const error = new Error('Tiempo de espera agotado.');
                    error.code = codigo;
                    rechazar(error);
                }, milisegundos);
            });
            return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
        },

        renderizarAcceso({ mensaje = '', error = '', cargando = false } = {}) {
            let overlay = document.getElementById('suite-login-google-plata');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'suite-login-google-plata';
                document.body.appendChild(overlay);
            }
            overlay.style.cssText = `position:fixed!important;top:68px!important;right:18px!important;left:auto!important;bottom:auto!important;width:min(355px,calc(100vw - 36px))!important;z-index:2147483646!important;background:transparent!important;pointer-events:none!important;display:block!important;padding:0!important;box-sizing:border-box!important;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;color:#f8fafc!important;`;
            if (this.accesoMinimizado) {
                overlay.style.setProperty('width', '218px', 'important');
                overlay.innerHTML = `<button id="suite-login-restaurar-btn" style="width:100%;pointer-events:auto;display:flex;align-items:center;gap:9px;background:linear-gradient(145deg,rgba(15,23,42,.98),rgba(15,118,110,.96));color:#f8fafc;border:1px solid rgba(45,212,191,.45);border-radius:12px;padding:8px 10px;box-shadow:0 14px 38px rgba(0,0,0,.42);cursor:pointer;text-align:left;"><span style="width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#10b981;font-size:9px;font-weight:950;">SD</span><span style="min-width:0;flex:1;"><b style="display:block;font-size:9px;">Iniciar sesión</b><small style="display:block;color:#a7f3d0;font-size:7px;margin-top:3px;">CRM disponible</small></span><span style="font-size:13px;">⌄</span></button>`;
                overlay.querySelector('#suite-login-restaurar-btn').onclick = () => {
                    this.accesoMinimizado = false;
                    this.renderizarAcceso({ mensaje, error, cargando });
                };
                return;
            }
            overlay.innerHTML = `<div style="pointer-events:auto;width:100%;background:linear-gradient(145deg,rgba(15,23,42,.98),rgba(17,45,48,.97));border:1px solid rgba(45,212,191,.38);border-radius:18px;padding:16px;box-sizing:border-box;box-shadow:0 22px 55px rgba(0,0,0,.5);text-align:left;">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:11px;"><div style="width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(145deg,#22c55e,#0f766e);font-size:11px;font-weight:950;box-shadow:0 10px 25px rgba(16,185,129,.26);">SD</div><span style="min-width:0;flex:1;"><span style="display:block;font-size:8px;letter-spacing:.16em;text-transform:uppercase;color:#5eead4;font-weight:900;">Acceso empresarial</span><b style="display:block;font-size:14px;margin-top:4px;">Sistema Dual</b></span><button id="suite-login-minimizar-btn" title="Minimizar acceso" style="background:rgba(51,65,85,.72);color:#cbd5e1;border:1px solid rgba(148,163,184,.2);border-radius:8px;padding:5px 8px;font-size:10px;font-weight:900;cursor:pointer;">—</button></div>
                <p style="font-size:9px;color:#94a3b8;line-height:1.5;margin:0 0 11px;">Inicia sesión para activar la suite y sincronizar tus datos. Puedes seguir usando el CRM mientras tanto.</p>
                ${error ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(248,113,113,.35);color:#fecaca;border-radius:9px;padding:8px;margin-bottom:9px;font-size:9px;line-height:1.4;">${String(error).replace(/[<>&]/g, '')}</div>` : ''}
                ${mensaje ? `<div style="color:#a7f3d0;font-size:9px;margin-bottom:9px;">${String(mensaje).replace(/[<>&]/g, '')}</div>` : ''}
                <button id="suite-login-google-btn" ${cargando ? 'disabled' : ''} style="width:100%;display:flex;align-items:center;justify-content:center;gap:9px;background:${cargando ? '#334155' : '#ffffff'};color:${cargando ? '#94a3b8' : '#172033'};border:0;border-radius:10px;padding:10px;font-size:10px;font-weight:900;cursor:${cargando ? 'wait' : 'pointer'};box-shadow:0 8px 22px rgba(0,0,0,.22);"><span style="font-size:14px;">↗</span>${cargando ? 'Verificando cuenta…' : 'Abrir acceso en ventana aparte'}</button>
                <div style="margin-top:9px;color:#64748b;font-size:7px;line-height:1.45;text-align:center;">Permitidas: @dif.tech y @plata.work</div>
            </div>`;
            overlay.querySelector('#suite-login-minimizar-btn').onclick = () => {
                this.accesoMinimizado = true;
                this.renderizarAcceso({ mensaje, error, cargando });
            };
            const boton = overlay.querySelector('#suite-login-google-btn');
            if (boton && !cargando) boton.onclick = () => this.abrirVentanaAcceso();
        },

        async prepararSDK() {
            const sdk = typeof firebase !== 'undefined' ? firebase : window.firebase;
            if (!sdk?.initializeApp || !sdk?.auth) throw new Error('No se cargó el componente de autenticación de Firebase.');
            this.sdk = sdk;
            if (!sdk.apps.length) sdk.initializeApp(FIREBASE_CONFIG);
            this.auth = sdk.auth();
            this.auth.useDeviceLanguage();
            await this.auth.setPersistence(sdk.auth.Auth.Persistence.LOCAL);
            return new Promise((resolve, reject) => {
                let terminado = false;
                let timeout = null;
                let cancelar = null;
                const finalizar = usuario => {
                    if (terminado) return;
                    terminado = true;
                    clearTimeout(timeout);
                    if (typeof cancelar === 'function') cancelar();
                    resolve(usuario || null);
                };
                timeout = setTimeout(() => finalizar(this.auth.currentUser), 10000);
                cancelar = this.auth.onAuthStateChanged(finalizar, reject);
            });
        },

        async inicializarObligatorio() {
            if (!ES_CRM) return null;
            this.activarReceptorVentana();
            this.renderizarAcceso({ mensaje: 'Verificando sesión…', cargando: true });
            try {
                const usuarioRestaurado = await this.prepararSDK();
                if (usuarioRestaurado && this.cuentaPermitida(usuarioRestaurado)) {
                    await this.finalizarAcceso(usuarioRestaurado);
                    this.activarVigilancia();
                    return usuarioRestaurado;
                }
                if (usuarioRestaurado) {
                    await this.auth.signOut();
                    this.olvidarSesionVisual();
                }
                const espera = new Promise(resolve => { this.resolverAcceso = resolve; });
                this.activarVigilancia();
                this.renderizarAcceso({ error: usuarioRestaurado ? 'Esta cuenta no pertenece a un dominio empresarial autorizado.' : '' });
                return espera;
            } catch (error) {
                const espera = new Promise(resolve => { this.resolverAcceso = resolve; });
                this.activarVigilancia();
                this.renderizarAcceso({ error: this.mensajeError(error) });
                return espera;
            }
        },

        abrirVentanaAcceso() {
            if (this.ventanaAcceso && !this.ventanaAcceso.closed) {
                this.ventanaAcceso.focus();
                this.renderizarAcceso({ mensaje: 'La ventana de acceso ya está abierta. Completa allí el inicio con Google.' });
                return;
            }
            const url = new URL(location.href);
            url.searchParams.set('sistema_dual_auth', '1');
            url.hash = '';
            const ancho = 470;
            const alto = 650;
            const izquierda = Math.max(0, Math.round((window.screenX || 0) + (window.outerWidth - ancho) / 2));
            const arriba = Math.max(0, Math.round((window.screenY || 0) + (window.outerHeight - alto) / 2));
            this.ventanaAcceso = window.open(url.toString(), 'SistemaDualAccesoGoogle', `popup=yes,width=${ancho},height=${alto},left=${izquierda},top=${arriba},resizable=yes,scrollbars=yes`);
            if (!this.ventanaAcceso) {
                this.renderizarAcceso({ error: 'Chrome bloqueó la ventana independiente. Permite ventanas emergentes para este CRM e inténtalo otra vez.' });
                return;
            }
            this.ventanaAcceso.focus();
            this.renderizarAcceso({ mensaje: 'Ventana de acceso abierta. El CRM permanecerá disponible mientras terminas.' });
            if (this.monitorVentana) clearInterval(this.monitorVentana);
            this.monitorVentana = setInterval(() => {
                if (this.ventanaAcceso && !this.ventanaAcceso.closed) return;
                clearInterval(this.monitorVentana);
                this.monitorVentana = null;
                this.ventanaAcceso = null;
                if (!this.usuario) this.renderizarAcceso({ error: 'La ventana de acceso se cerró antes de vincular una cuenta.' });
            }, 700);
        },

        renderizarVentanaExterna({ mensaje = '', error = '', cargando = false, completado = false } = {}) {
            document.title = 'Acceso · Sistema Dual';
            document.documentElement.style.cssText = 'min-height:100%;background:#07141b;color-scheme:dark;';
            document.body.style.cssText = "margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:radial-gradient(circle at 20% 15%,rgba(16,185,129,.24),transparent 35%),linear-gradient(145deg,#07111d,#0d2528);font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#f8fafc;";
            document.body.innerHTML = `<main style="width:min(390px,100%);background:linear-gradient(145deg,rgba(15,23,42,.98),rgba(17,45,48,.98));border:1px solid rgba(45,212,191,.38);border-radius:22px;padding:26px;box-sizing:border-box;box-shadow:0 28px 80px rgba(0,0,0,.55);text-align:center;">
                <div style="width:58px;height:58px;display:grid;place-items:center;margin:0 auto 16px;border-radius:18px;background:linear-gradient(145deg,#22c55e,#0f766e);font-size:16px;font-weight:950;box-shadow:0 12px 30px rgba(16,185,129,.28);">SD</div>
                <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#5eead4;font-weight:900;">Acceso empresarial</div>
                <h1 style="font-size:22px;margin:8px 0 8px;">Sistema Dual</h1>
                <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0 0 18px;">Esta ventana es únicamente para iniciar sesión. Tu CRM permanece abierto y no será recargado.</p>
                ${error ? `<div style="background:rgba(239,68,68,.12);border:1px solid rgba(248,113,113,.35);color:#fecaca;border-radius:11px;padding:11px;margin-bottom:13px;font-size:11px;line-height:1.5;">${String(error).replace(/[<>&]/g, '')}</div>` : ''}
                ${mensaje ? `<div style="color:${completado ? '#86efac' : '#a7f3d0'};font-size:11px;line-height:1.5;margin-bottom:13px;">${String(mensaje).replace(/[<>&]/g, '')}</div>` : ''}
                ${completado ? '<div style="font-size:28px;margin:4px 0 12px;">✓</div><small style="display:block;color:#64748b;font-size:9px;">Esta ventana se cerrará automáticamente.</small>' : cargando ? '<div style="width:100%;background:#334155;color:#94a3b8;border-radius:12px;padding:13px;box-sizing:border-box;font-size:12px;font-weight:900;">Verificando sesión…</div>' : '<div id="suite-google-button" style="min-height:44px;display:flex;align-items:center;justify-content:center;"></div><small style="display:block;color:#64748b;font-size:9px;line-height:1.5;margin-top:14px;">Solo cuentas @dif.tech y @plata.work</small>'}
            </main>`;
        },

        async inicializarVentanaExterna() {
            this.renderizarVentanaExterna({ mensaje: 'Comprobando si ya existe una sesión…', cargando: true });
            try {
                const usuario = await this.prepararSDK();
                if (usuario && this.cuentaPermitida(usuario)) {
                    await this.completarVentanaExterna(usuario);
                    return;
                }
                if (usuario) await this.auth.signOut();
                this.prepararBotonGoogle(usuario ? 'Esta cuenta no pertenece a un dominio empresarial autorizado.' : '');
            } catch (error) {
                this.prepararBotonGoogle(this.mensajeError(error));
            }
        },

        obtenerGoogleIdentity() {
            const servicio = typeof google !== 'undefined' ? google : window.google;
            return servicio?.accounts?.id || null;
        },

        prepararBotonGoogle(error = '') {
            this.iniciando = false;
            this.renderizarVentanaExterna({ mensaje: 'Selecciona tu cuenta empresarial de Google.', error });
            const contenedor = document.getElementById('suite-google-button');
            const identidad = this.obtenerGoogleIdentity();
            if (!contenedor || !identidad) {
                this.renderizarVentanaExterna({ error: 'No se pudo cargar accounts.google.com. Verifica que Google Identity Services esté permitido en la red.' });
                return;
            }
            try {
                identidad.initialize({
                    client_id: GOOGLE_OAUTH_CLIENT_ID,
                    callback: respuesta => this.procesarCredencialGoogle(respuesta),
                    auto_select: false,
                    cancel_on_tap_outside: false
                });
                identidad.renderButton(contenedor, {
                    type: 'standard',
                    theme: 'outline',
                    size: 'large',
                    text: 'continue_with',
                    shape: 'pill',
                    logo_alignment: 'left',
                    width: 320
                });
            } catch (errorGoogle) {
                this.renderizarVentanaExterna({ error: `Google no pudo preparar el acceso: ${this.mensajeError(errorGoogle)}` });
            }
        },

        async procesarCredencialGoogle(respuesta) {
            if (this.iniciando) return;
            if (!respuesta?.credential) {
                this.prepararBotonGoogle('Google no entregó una credencial. Selecciona nuevamente la cuenta.');
                return;
            }
            this.iniciando = true;
            this.renderizarVentanaExterna({ mensaje: 'Google confirmó la cuenta. Vinculando con Firebase…', cargando: true });
            try {
                if (!this.auth) await this.prepararSDK();
                const credencialFirebase = this.sdk.auth.GoogleAuthProvider.credential(respuesta.credential);
                const accesoFirebase = this.auth.signInWithCredential(credencialFirebase);
                accesoFirebase.catch(() => {});
                const resultado = await this.conTiempoLimite(accesoFirebase, 15000, 'suite/credential-timeout');
                const usuario = resultado?.user;
                if (!this.cuentaPermitida(usuario)) {
                    await this.auth.signOut();
                    this.prepararBotonGoogle('Acceso rechazado. Usa una cuenta @dif.tech o @plata.work.');
                    return;
                }
                await this.completarVentanaExterna(usuario);
            } catch (error) {
                this.iniciando = false;
                this.prepararBotonGoogle(this.mensajeError(error));
            }
        },

        notificarSesionVentana(usuario) {
            const aviso = { tipo: 'sistema-dual-auth-ok', uid: usuario.uid, email: usuario.email || '' };
            try { window.opener?.postMessage(aviso, location.origin); } catch (_) {}
            try {
                const canal = new BroadcastChannel('sistema-dual-auth');
                canal.postMessage(aviso);
                canal.close();
            } catch (_) {}
        },

        async completarVentanaExterna(usuario) {
            if (!this.cuentaPermitida(usuario)) {
                await this.auth.signOut();
                this.renderizarVentanaExterna({ error: 'Acceso rechazado. Usa una cuenta @dif.tech o @plata.work.' });
                return;
            }
            this.usuario = usuario;
            this.recordarSesionVisual(usuario);
            await this.guardarPerfil();
            this.notificarSesionVentana(usuario);
            this.renderizarVentanaExterna({ mensaje: `Cuenta vinculada: ${usuario.email || ''}`, completado: true });
            setTimeout(() => window.close(), 1200);
        },

        activarReceptorVentana() {
            if (this.receptorVentanaActivo || MODO_VENTANA_AUTH) return;
            this.receptorVentanaActivo = true;
            const recibir = evento => {
                const datos = evento?.data || evento;
                if (evento?.origin && evento.origin !== location.origin) return;
                if (datos?.tipo !== 'sistema-dual-auth-ok') return;
                this.renderizarAcceso({ mensaje: 'Cuenta validada. Sincronizando la sesión con el CRM…', cargando: true });
                const inicio = Date.now();
                const revisar = async () => {
                    const usuario = this.auth?.currentUser;
                    if (usuario && this.cuentaPermitida(usuario)) {
                        await this.finalizarAcceso(usuario);
                        return;
                    }
                    if (Date.now() - inicio < 10000) {
                        setTimeout(revisar, 300);
                        return;
                    }
                    this.renderizarAcceso({ error: 'Google validó la cuenta, pero el CRM todavía no recibió la sesión. Cierra la ventana de acceso y vuelve a intentarlo.' });
                };
                revisar();
            };
            window.addEventListener('message', recibir);
            try {
                this.canalAcceso = new BroadcastChannel('sistema-dual-auth');
                this.canalAcceso.onmessage = recibir;
            } catch (_) {}
        },

        async finalizarAcceso(usuario) {
            if (!this.cuentaPermitida(usuario)) return false;
            if (this.usuario?.uid === usuario.uid && !this.resolverAcceso && !document.getElementById('suite-login-google-plata') && this.perfilSincronizado) return true;
            this.usuario = usuario;
            this.recordarSesionVisual(usuario);
            await this.guardarPerfil();
            document.getElementById('suite-login-google-plata')?.remove();
            const resolver = this.resolverAcceso;
            this.resolverAcceso = null;
            if (resolver) resolver(usuario);
            return true;
        },

        async getToken(forzar = false) {
            if (!this.usuario) throw new Error('Sesión requerida.');
            return this.usuario.getIdToken(forzar);
        },

        activarVigilancia() {
            if (!this.auth || this.cancelarVigilancia) return;
            this.cancelarVigilancia = this.auth.onAuthStateChanged(usuario => {
                if (usuario && this.cuentaPermitida(usuario)) {
                    this.finalizarAcceso(usuario);
                    return;
                }
                if (this.usuario) {
                    this.usuario = null;
                    this.olvidarSesionVisual();
                    this.renderizarAcceso({ error: 'La sesión terminó. Inicia sesión nuevamente para continuar.' });
                }
            });
        },

        async guardarPerfil() {
            if (!this.usuario) return false;
            try {
                const token = await this.getToken();
                const perfil = {
                    uid: this.usuario.uid,
                    email: String(this.usuario.email || ''),
                    claveCorreo: OBTENER_CLAVE_CORREO(),
                    nombre: this.usuario.displayName || String(this.usuario.email || '').split('@')[0],
                    foto: this.usuario.photoURL || '',
                    dominio: this.obtenerDominio(this.usuario.email),
                    correoVerificado: this.usuario.emailVerified === true,
                    ultimoAcceso: new Date().toISOString(),
                    versionSuite: SUITE_VERSION
                };
                const claveCorreo = OBTENER_CLAVE_CORREO();
                if (!claveCorreo) throw new Error('No fue posible identificar el correo del agente.');
                const url = `${CLOUD_CONFIG.FIREBASE_URL}/agentes_por_correo/${encodeURIComponent(claveCorreo)}/perfil.json?auth=${encodeURIComponent(token)}`;
                const response = await FETCH_CON_TIMEOUT(url, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(perfil) });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                this.perfilSincronizado = true;
                if (this.reintentoPerfil) { clearTimeout(this.reintentoPerfil); this.reintentoPerfil = null; }
                if (typeof DOM !== 'undefined' && DOM.kb && typeof STATE !== 'undefined' && STATE.posKB.vista === 'inicio' && !STATE.posKB.minimizado) {
                    UI_MANAGER.renderizarInicioHerramientas();
                }
                return true;
            } catch (error) {
                this.perfilSincronizado = false;
                console.warn('[Firebase] No se pudo actualizar el perfil:', error);
                if (!this.reintentoPerfil) {
                    this.reintentoPerfil = setTimeout(() => {
                        this.reintentoPerfil = null;
                        if (this.usuario) this.guardarPerfil();
                    }, 30000);
                }
                return false;
            }
        },

        async cerrarSesion() {
            try {
                if (typeof STATE !== 'undefined') {
                    await Promise.allSettled([
                        CLOUD_SYNC.guardarScripts(STATE.scriptsPersonalizados),
                        CLOUD_SYNC.guardarLlamadasNube(STATE.registroLlamadas)
                    ]);
                }
                if (this.auth) await this.auth.signOut();
            } finally {
                this.usuario = null;
                this.olvidarSesionVisual();
                window.location.reload();
            }
        }
    };

    const OBTENER_ID_AGENTE = () => AUTH_MANAGER.usuario?.uid || '';
    const CREAR_CLAVE_CORREO = email => String(email || '')
        .trim()
        .toLowerCase()
        .replace(/%/g, '%25')
        .replace(/,/g, '%2C')
        .replace(/\./g, ',')
        .replace(/\$/g, '%24')
        .replace(/#/g, '%23')
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D')
        .replace(/\//g, '%2F');
    const OBTENER_CLAVE_CORREO = () => CREAR_CLAVE_CORREO(AUTH_MANAGER.usuario?.email || '');
    const CLAVE_USUARIO = claveBase => {
        const uid = OBTENER_ID_AGENTE();
        return uid ? `${claveBase}__${uid}` : claveBase;
    };

    const CLOUD_SYNC = {
        async construirURL(recurso, legadoUID = false) {
            const agenteId = OBTENER_ID_AGENTE();
            const claveCorreo = OBTENER_CLAVE_CORREO();
            if (!agenteId || !claveCorreo) throw new Error('No hay una sesión autenticada.');
            const token = await AUTH_MANAGER.getToken();
            const rutaAgente = legadoUID
                ? `agentes/${encodeURIComponent(agenteId)}`
                : `agentes_por_correo/${encodeURIComponent(claveCorreo)}`;
            return `${CLOUD_CONFIG.FIREBASE_URL}/${rutaAgente}/${recurso}.json?auth=${encodeURIComponent(token)}`;
        },

        async descargarConMigracion(recurso) {
            const urlCorreo = await this.construirURL(recurso);
            const responseCorreo = await FETCH_CON_TIMEOUT(urlCorreo);
            if (!responseCorreo.ok) throw new Error(`HTTP ${responseCorreo.status}`);
            const datosCorreo = await responseCorreo.json();
            if (Array.isArray(datosCorreo)) return datosCorreo;

            // La ruta UID se consulta solo como respaldo de versiones anteriores.
            // Si contiene datos, se copian por PUT a la ruta legible por correo.
            const urlUID = await this.construirURL(recurso, true);
            const responseUID = await FETCH_CON_TIMEOUT(urlUID);
            if (!responseUID.ok) return null;
            const datosUID = await responseUID.json();
            if (!Array.isArray(datosUID)) return null;
            const migracion = await FETCH_CON_TIMEOUT(urlCorreo, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(datosUID)
            });
            if (!migracion.ok) throw new Error(`HTTP ${migracion.status}`);
            console.log(`[Firebase] ${recurso} migrado a la categoría ${OBTENER_CLAVE_CORREO()}.`);
            return datosUID;
        },

        async descargarScripts() {
            if (!CLOUD_CONFIG.FIREBASE_URL) return null;

            try {
                return await this.descargarConMigracion('scripts');
            } catch (e) {
                console.warn("[Firebase] Error descargando scripts de la nube:", e);
            }
            return null;
        },

        async guardarScripts(scripts) {
            if (!CLOUD_CONFIG.FIREBASE_URL) return;
            try {
                const url = await this.construirURL('scripts');
                const response = await FETCH_CON_TIMEOUT(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(scripts)
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                console.log(`[Firebase] Scripts sobrescritos para ${AUTH_MANAGER.usuario?.email || 'la cuenta autenticada'}.`);
                return true;
            } catch (e) {
                console.error("[Firebase] Error guardando scripts en la nube:", e);
                return false;
            }
        },

        async guardarLlamadasNube(llamadas) {
            if (!CLOUD_CONFIG.FIREBASE_URL) return;
            try {
                const url = await this.construirURL('llamadas');
                const response = await FETCH_CON_TIMEOUT(url, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(llamadas)
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                console.log(`[Firebase] Llamadas sobrescritas para ${AUTH_MANAGER.usuario?.email || 'la cuenta autenticada'}.`);
                return true;
            } catch (e) {
                console.error("[Firebase] Error guardando llamadas en la nube:", e);
                return false;
            }
        },

        async descargarLlamadasNube() {
            if (!CLOUD_CONFIG.FIREBASE_URL) return null;
            try {
                return await this.descargarConMigracion('llamadas');
            } catch (e) {
                console.warn("[Firebase] Error descargando llamadas:", e);
            }
            return null;
        }
    };

    // =========================================================================
    // NOTICIAS PARA AGENTES
    // =========================================================================
    const NUBE_COMPARTIDA = {
        noticiaActual: null,
        ultimoError: '',
        temporizadorNoticias: null,

        esAdmin() {
            return String(AUTH_MANAGER.usuario?.email || '').trim().toLowerCase() === NOTICIAS_ADMIN_EMAIL;
        },

        async construirURL(ruta) {
            const token = await AUTH_MANAGER.getToken();
            return `${CLOUD_CONFIG.FIREBASE_URL}/${String(ruta || '').replace(/^\/+/, '')}.json?auth=${encodeURIComponent(token)}`;
        },

        resumirRuta(ruta) {
            const valor = String(ruta || 'Firebase');
            if (valor.includes('noticias')) return 'noticias';
            return valor.split('/').slice(0, 2).join('/');
        },

        prepararError(error, etapa, ruta, codigo = '') {
            const fallo = error instanceof Error ? error : new Error(String(error || 'Error desconocido'));
            fallo.suiteEtapa = fallo.suiteEtapa || etapa || 'Sincronización';
            fallo.suiteRuta = fallo.suiteRuta || this.resumirRuta(ruta);
            fallo.suiteCodigo = fallo.suiteCodigo || codigo || (fallo.name === 'AbortError' ? 'TIEMPO_AGOTADO' : 'RED');
            return fallo;
        },


        async solicitar(ruta, opciones = {}, contexto = {}) {
            const etapa = contexto.etapa || 'Conectar con Firebase';
            try {
                const url = await this.construirURL(ruta);
                const response = await FETCH_CON_TIMEOUT(url, {
                    ...opciones,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(opciones.headers || {})
                    }
                }, 10000);
                if (!response.ok) {
                    const respuesta = await response.text().catch(() => '');
                    let detalle = respuesta;
                    try { detalle = JSON.parse(respuesta)?.error || respuesta; } catch (_) {}
                    const error = new Error(String(detalle || `Firebase respondió HTTP ${response.status}`).slice(0, 150));
                    throw this.prepararError(error, etapa, ruta, `HTTP_${response.status}`);
                }
                if (response.status === 204) return null;
                const texto = await response.text();
                return texto ? JSON.parse(texto) : null;
            } catch (error) {
                throw this.prepararError(error, etapa, ruta);
            }
        },

        async cargarNoticia() {
            if (!AUTH_MANAGER.usuario) return;
            try {
                const noticia = await this.solicitar('noticias/actual');
                const firmaAnterior = JSON.stringify(this.noticiaActual || null);
                this.noticiaActual = noticia && typeof noticia === 'object' ? noticia : null;
                if (firmaAnterior !== JSON.stringify(this.noticiaActual || null)
                    && typeof UI_MANAGER !== 'undefined'
                    && STATE.posKB.vista === 'inicio'
                    && !STATE.posKB.minimizado) {
                    UI_MANAGER.renderizarInicioHerramientas();
                }
            } catch (error) {
                this.ultimoError = error?.message || this.ultimoError;
            }
        },

        noticiaVisible() {
            const noticia = this.noticiaActual;
            if (!noticia?.activa) return false;
            return !Number(noticia.venceEn) || Number(noticia.venceEn) > Date.now();
        },

        renderizarNoticiaInicio() {
            const admin = this.esAdmin();
            const noticia = this.noticiaActual;
            if (!admin && !this.noticiaVisible()) return '';
            if (!noticia) {
                return admin ? `<div class="suite-tarjeta-plata" style="margin-bottom:10px;border-style:dashed;text-align:center;"><div class="suite-eyebrow-plata">Noticias para agentes</div><div style="font-size:9px;color:var(--sd-tenue);line-height:1.5;margin:7px 0 9px;">Todavía no hay una noticia publicada.</div><button class="suite-boton-plata" data-action="noticia-editar">＋ Crear noticia</button></div>` : '';
            }
            const prioridad = ['INFORMATIVA', 'IMPORTANTE', 'URGENTE'].includes(noticia.prioridad) ? noticia.prioridad : 'INFORMATIVA';
            const icono = prioridad === 'URGENTE' ? '!' : prioridad === 'IMPORTANTE' ? '◆' : 'i';
            const fecha = Number(noticia.actualizadaEn || noticia.publicadaEn) > 0
                ? new Date(Number(noticia.actualizadaEn || noticia.publicadaEn)).toLocaleString('es-MX', { dateStyle:'medium', timeStyle:'short' })
                : '';
            const estadoAdmin = noticia.activa ? 'Publicada' : 'Desactivada';
            return `<div class="suite-tarjeta-plata" style="margin-bottom:10px;border-color:${prioridad === 'URGENTE' ? 'rgba(248,113,113,.65)' : prioridad === 'IMPORTANTE' ? 'rgba(250,204,21,.55)' : 'var(--sd-borde)'};">
                <div style="display:flex;align-items:flex-start;gap:10px;">
                    <span style="width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:var(--sd-acento-suave);color:var(--sd-acento);font-size:13px;font-weight:950;flex:0 0 auto;">${icono}</span>
                    <span style="min-width:0;flex:1;"><span class="suite-eyebrow-plata">${prioridad}</span><b style="display:block;font-size:11px;margin-top:5px;">${UTILS.escaparHTML(noticia.titulo || '')}</b><span style="display:block;font-size:9px;color:var(--sd-texto);line-height:1.55;margin-top:6px;white-space:pre-wrap;user-select:text;">${UTILS.escaparHTML(noticia.mensaje || '')}</span><small style="display:block;font-size:7px;color:var(--sd-tenue);margin-top:7px;">${UTILS.escaparHTML(fecha)}</small></span>
                    ${admin ? `<span class="suite-chip-plata">${estadoAdmin}</span>` : ''}
                </div>
                ${admin ? `<div style="display:flex;gap:6px;margin-top:9px;"><button class="suite-boton-plata secundario" data-action="noticia-editar" style="flex:1;">Editar</button><button class="suite-boton-plata secundario" data-action="noticia-alternar" style="flex:1;">${noticia.activa ? 'Desactivar' : 'Activar'}</button></div>` : ''}
            </div>`;
        },

        abrirEditorNoticia() {
            if (!this.esAdmin()) return;
            document.getElementById('suite-noticia-editor')?.remove();
            const noticia = this.noticiaActual || {};
            const modal = document.createElement('div');
            modal.id = 'suite-noticia-editor';
            modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.46);backdrop-filter:blur(5px);display:grid;place-items:center;padding:18px;box-sizing:border-box;font-family:Inter,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;';
            modal.innerHTML = `<div class="suite-paleta-caja" style="width:min(430px,100%);background:var(--sd-panel-bg);color:var(--sd-texto);border:1px solid var(--sd-borde);border-radius:18px;padding:16px;box-shadow:var(--sd-sombra);box-sizing:border-box;">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px;"><span><span class="suite-eyebrow-plata">Solo administrador</span><b style="display:block;font-size:14px;margin-top:4px;">Noticia para agentes</b></span><button class="suite-boton-plata secundario" data-action="noticia-cerrar">×</button></div>
                <label style="display:block;font-size:8px;color:var(--sd-tenue);margin-bottom:5px;">Título</label>
                <input id="suite-noticia-titulo" class="suite-input-plata" maxlength="90" value="${UTILS.escaparHTML(noticia.titulo || '')}" placeholder="Título de la noticia">
                <label style="display:block;font-size:8px;color:var(--sd-tenue);margin:10px 0 5px;">Mensaje</label>
                <textarea id="suite-noticia-mensaje" class="suite-input-plata" maxlength="700" style="height:145px;resize:vertical;" placeholder="Escribe la información que verán los agentes…">${UTILS.escaparHTML(noticia.mensaje || '')}</textarea>
                <label style="display:block;font-size:8px;color:var(--sd-tenue);margin:10px 0 5px;">Prioridad</label>
                <select id="suite-noticia-prioridad" class="suite-input-plata"><option value="INFORMATIVA" ${noticia.prioridad === 'INFORMATIVA' ? 'selected' : ''}>Informativa</option><option value="IMPORTANTE" ${noticia.prioridad === 'IMPORTANTE' ? 'selected' : ''}>Importante</option><option value="URGENTE" ${noticia.prioridad === 'URGENTE' ? 'selected' : ''}>Urgente</option></select>
                <div id="suite-noticia-error" style="min-height:16px;color:#fca5a5;font-size:8px;margin-top:8px;"></div>
                <div style="display:flex;gap:7px;margin-top:4px;"><button class="suite-boton-plata secundario" data-action="noticia-cerrar" style="flex:1;">Cancelar</button><button class="suite-boton-plata" data-action="noticia-guardar" style="flex:1;">Guardar y publicar</button></div>
            </div>`;
            document.body.appendChild(modal);
            modal.querySelector('#suite-noticia-titulo')?.focus();
        },

        async guardarNoticiaDesdeEditor() {
            if (!this.esAdmin()) return false;
            const modal = document.getElementById('suite-noticia-editor');
            const titulo = String(modal?.querySelector('#suite-noticia-titulo')?.value || '').trim();
            const mensaje = String(modal?.querySelector('#suite-noticia-mensaje')?.value || '').trim();
            const prioridad = String(modal?.querySelector('#suite-noticia-prioridad')?.value || 'INFORMATIVA');
            const errorEl = modal?.querySelector('#suite-noticia-error');
            if (titulo.length < 3 || mensaje.length < 3) {
                if (errorEl) errorEl.textContent = 'Escribe un título y un mensaje completos.';
                return false;
            }
            const boton = modal?.querySelector('[data-action="noticia-guardar"]');
            if (boton) { boton.disabled = true; boton.textContent = 'Guardando…'; }
            const ahora = Date.now();
            const noticia = {
                titulo: titulo.slice(0, 90),
                mensaje: mensaje.slice(0, 700),
                prioridad: ['INFORMATIVA', 'IMPORTANTE', 'URGENTE'].includes(prioridad) ? prioridad : 'INFORMATIVA',
                activa: true,
                publicadaEn: Number(this.noticiaActual?.publicadaEn) || ahora,
                actualizadaEn: ahora,
                venceEn: Number(this.noticiaActual?.venceEn) || 0,
                autorEmail: NOTICIAS_ADMIN_EMAIL,
                version: Math.max(1, Number(this.noticiaActual?.version || 0) + 1)
            };
            try {
                await this.solicitar('noticias/actual', { method:'PUT', body:JSON.stringify(noticia) });
                this.noticiaActual = noticia;
                modal?.remove();
                if (typeof UI_MANAGER !== 'undefined') {
                    UI_MANAGER.renderizarInicioHerramientas();
                    UI_MANAGER.mostrarToast('Noticia publicada para los agentes');
                }
                return true;
            } catch (error) {
                if (errorEl) errorEl.textContent = `No se pudo guardar: ${error?.message || 'error de conexión'}`;
                if (boton) { boton.disabled = false; boton.textContent = 'Guardar y publicar'; }
                return false;
            }
        },

        async alternarNoticia() {
            if (!this.esAdmin() || !this.noticiaActual) return;
            const ahora = Date.now();
            const noticia = {
                ...this.noticiaActual,
                activa: !this.noticiaActual.activa,
                actualizadaEn: ahora,
                autorEmail: NOTICIAS_ADMIN_EMAIL,
                version: Math.max(1, Number(this.noticiaActual.version || 0) + 1)
            };
            await this.solicitar('noticias/actual', { method:'PUT', body:JSON.stringify(noticia) });
            this.noticiaActual = noticia;
            if (typeof UI_MANAGER !== 'undefined') {
                UI_MANAGER.renderizarInicioHerramientas();
                UI_MANAGER.mostrarToast(noticia.activa ? 'Noticia activada' : 'Noticia desactivada');
            }
        },

        iniciarEnSegundoPlano() {
            if (!AUTH_MANAGER.usuario) return;
            this.cargarNoticia();
            if (!this.temporizadorNoticias) {
                this.temporizadorNoticias = setInterval(() => this.cargarNoticia(), 3 * 60 * 1000);
            }
        }
    };

    // =========================================================================
    // 1. CONFIGURACIÓN GENERAL Y PLANTILLAS
    // =========================================================================
    const INTERACCION_NORMAL = {
        valores: { avisoMin: 5, sinRespuestaMin: 12 },
        validar(avisoMin, sinRespuestaMin) {
            return Number.isInteger(avisoMin) && Number.isInteger(sinRespuestaMin)
                && avisoMin >= 1 && sinRespuestaMin > avisoMin && sinRespuestaMin <= 240;
        },
        cargar() {
            this.valores = { avisoMin: 5, sinRespuestaMin: 12 };
            try {
                const datos = JSON.parse(localStorage.getItem(CLAVE_USUARIO('interaccion_normal_v1')) || 'null');
                if (datos && this.validar(datos.avisoMin, datos.sinRespuestaMin)) this.valores = datos;
            } catch (_) {}
        },
        guardar(avisoMin, sinRespuestaMin) {
            if (!this.validar(avisoMin, sinRespuestaMin)) throw new Error('Usa minutos enteros: el primer aviso debe ser al menos 1 y Sin respuesta debe ser mayor, hasta 240 minutos.');
            const datos = { avisoMin, sinRespuestaMin };
            localStorage.setItem(CLAVE_USUARIO('interaccion_normal_v1'), JSON.stringify(datos));
            this.valores = datos;
        },
        visualizar(chat) {
            if (chat.tipo === 'bienvenida') return { etiqueta:'Primer mensaje', color:'#38bdf8', clase:'bienvenida', nivel:0 };
            if (chat.tipo === 'cliente_respondio') return { etiqueta:'En espera de respuesta', color:'#d8b4fe', clase:'respuesta', nivel:0 };
            if (chat.tiempo >= this.valores.sinRespuestaMin * 60) return { etiqueta:'Sin respuesta', color:'#ef4444', clase:'urgente', nivel:2 };
            if (chat.tiempo >= this.valores.avisoMin * 60) return { etiqueta:'Primer aviso', color:'#f59e0b', clase:'aviso', nivel:1 };
            return { etiqueta:'Seguimiento', color:'#34d399', clase:'', nivel:0 };
        }
    };

    const CONFIG = {
        HORA_ACTUALIZACION: { hora: 7, minuto: 10 },
        HORA_RESPALDO_DIARIO: { hora: 7, minuto: 30 },
        PLANTILLAS_BASE: [
            { titulo: "☀️ Saludo Corto", texto: "[SALUDO], XXX.", comando: "/sc" },
            { titulo: "👋 Saludo Completo", texto: "[SALUDO], XXX. ¿En qué te puedo apoyar el día de hoy?", comando: "/s" },
            { titulo: "⏳ Validar Información", texto: "[SALUDO], XXX. Permíteme un momento mientras valido tu información.", comando: "/v" },
            { titulo: "❌ Motivo Cancelación", texto: "[SALUDO], XXX. Para cancelar una solicitud, el sistema me pide un motivo. ¿Tienes uno en específico?", comando: "/c" },
            { titulo: "🔄 Actualizar Datos", texto: "[SALUDO], XXX. ¿Qué datos deseas actualizar?", comando: "/act" },
            { titulo: "😊 Despedida Amable", texto: "Al contrario XXX, que tengas un excelente día. Hasta luego. 😊", comando: "/bye" }
        ],
        ESTILO_GLASSMORPHISM: `
            position: fixed !important; z-index: 99999999 !important;
            background: var(--sd-panel-bg, linear-gradient(145deg, rgba(15, 23, 42, .985), rgba(7, 17, 31, .985))) !important;
            backdrop-filter: blur(15px) saturate(125%) !important;
            -webkit-backdrop-filter: blur(15px) saturate(125%) !important;
            color: var(--sd-texto, #f7faff) !important;
            font-family: 'Inter', -apple-system, sans-serif !important;
            border: 1px solid var(--sd-borde, rgba(190, 207, 226, .24)) !important;
            box-shadow: var(--sd-sombra, 0 20px 48px rgba(15, 23, 42, .30)), inset 0 1px rgba(255, 255, 255, .065) !important;
            box-sizing: border-box !important;
            border-radius: 20px !important;
        `
    };

    const PALETAS_VISUALES = {
        verde: {
            nombre: 'Verde original', subtitulo: 'Identidad clásica de Sistema Dual', icono: '◆', muestra: ['#30425c','#1e2f47','#20d3a3'],
            oscuro: { panel:'#30425c', panel2:'#1e2f47', texto:'#f7faff', tenue:'#bdcad9', borde:'rgba(190,207,226,.24)', tarjeta:'rgba(255,255,255,.058)', tarjetaHover:'rgba(255,255,255,.085)', campo:'rgba(24,40,62,.72)', acento:'#20d3a3', acento2:'#48e6bd', tinta:'#04110d', sombra:'0 20px 48px rgba(15,23,42,.30)', scrollTrack:'rgba(25,41,63,.34)' },
            claro: { panel:'#ffffff', panel2:'#edf9f5', texto:'#18332d', tenue:'#60746f', borde:'rgba(15,118,110,.20)', tarjeta:'rgba(255,255,255,.82)', tarjetaHover:'rgba(16,185,129,.10)', campo:'rgba(255,255,255,.94)', acento:'#0f9f75', acento2:'#0f766e', tinta:'#ffffff', sombra:'0 18px 44px rgba(15,118,110,.14)', scrollTrack:'rgba(203,229,220,.55)' }
        },
        ice: {
            nombre: 'Executive Ice', subtitulo: 'Fintech limpio y luminoso', icono: '❄', muestra: ['#2878ff','#53d6ff','#f4f7fb'],
            oscuro: { panel:'#284463', panel2:'#1d334e', texto:'#f8fbff', tenue:'#c1cede', borde:'rgba(125,190,255,.28)', tarjeta:'rgba(255,255,255,.070)', tarjetaHover:'rgba(83,214,255,.14)', campo:'rgba(24,52,78,.82)', acento:'#53b7ff', acento2:'#69e0ff', tinta:'#08223b', sombra:'0 22px 52px rgba(20,43,69,.34)', scrollTrack:'rgba(21,48,72,.42)' },
            claro: { panel:'#ffffff', panel2:'#eaf3ff', texto:'#17233c', tenue:'#66758c', borde:'rgba(40,120,255,.19)', tarjeta:'rgba(255,255,255,.88)', tarjetaHover:'rgba(40,120,255,.09)', campo:'rgba(255,255,255,.96)', acento:'#2878ff', acento2:'#00a7d9', tinta:'#ffffff', sombra:'0 18px 45px rgba(40,92,150,.15)', scrollTrack:'rgba(205,222,241,.60)' }
        },
        titanium: {
            nombre: 'Titanium', subtitulo: 'Metal sobrio y corporativo', icono: '⬡', muestra: ['#8d9aaa','#596675','#eef2f6'],
            oscuro: { panel:'#46515e', panel2:'#303a45', texto:'#fbfcfe', tenue:'#cbd4dd', borde:'rgba(210,220,230,.24)', tarjeta:'rgba(255,255,255,.075)', tarjetaHover:'rgba(215,226,236,.13)', campo:'rgba(43,54,66,.86)', acento:'#aebbc8', acento2:'#d9e2ea', tinta:'#202932', sombra:'0 22px 50px rgba(25,32,40,.34)', scrollTrack:'rgba(39,49,60,.44)' },
            claro: { panel:'#fbfcfd', panel2:'#e8edf2', texto:'#263447', tenue:'#687789', borde:'rgba(89,102,117,.20)', tarjeta:'rgba(255,255,255,.88)', tarjetaHover:'rgba(100,116,139,.10)', campo:'rgba(255,255,255,.96)', acento:'#657587', acento2:'#37475a', tinta:'#ffffff', sombra:'0 18px 44px rgba(63,77,92,.15)', scrollTrack:'rgba(205,214,223,.62)' }
        },
        aurora: {
            nombre: 'Aurora', subtitulo: 'Azul, violeta y luz tecnológica', icono: '✦', muestra: ['#8b5cf6','#52e0bb','#62a8ff'],
            oscuro: { panel:'#293c5d', panel2:'#352e60', texto:'#fbfaff', tenue:'#d1cce4', borde:'rgba(181,155,255,.29)', tarjeta:'rgba(255,255,255,.070)', tarjetaHover:'rgba(139,92,246,.16)', campo:'rgba(39,43,79,.84)', acento:'#a78bfa', acento2:'#52e0bb', tinta:'#17122a', sombra:'0 22px 54px rgba(25,22,61,.38)', scrollTrack:'rgba(37,39,75,.46)' },
            claro: { panel:'#ffffff', panel2:'#f0ecff', texto:'#292242', tenue:'#746d88', borde:'rgba(124,58,237,.19)', tarjeta:'rgba(255,255,255,.88)', tarjetaHover:'rgba(139,92,246,.10)', campo:'rgba(255,255,255,.96)', acento:'#7c3aed', acento2:'#0f9f82', tinta:'#ffffff', sombra:'0 18px 46px rgba(102,76,170,.16)', scrollTrack:'rgba(220,211,241,.62)' }
        }
    };

    // Historial operativo local. No guarda mensajes ni transcripciones y se
    // separa por la cuenta empresarial que inició sesión.
    const HISTORIAL_LOCAL = {
        nombreDB: 'SistemaDualHistorialV1',
        almacen: 'interacciones',
        correo: '',
        dbPromise: null,
        diasRetencion: 7,

        configurar(correo) {
            this.correo = String(correo || '').trim().toLowerCase();
        },

        abrir() {
            if (this.dbPromise) return this.dbPromise;
            this.dbPromise = new Promise((resolve, reject) => {
                if (!window.indexedDB) return reject(new Error('IndexedDB no disponible'));
                const solicitud = indexedDB.open(this.nombreDB, 1);
                solicitud.onupgradeneeded = () => {
                    const db = solicitud.result;
                    if (!db.objectStoreNames.contains(this.almacen)) {
                        const store = db.createObjectStore(this.almacen, { keyPath: 'id' });
                        store.createIndex('correo', 'correo', { unique: false });
                        store.createIndex('finISO', 'finISO', { unique: false });
                    }
                };
                solicitud.onsuccess = () => resolve(solicitud.result);
                solicitud.onerror = () => reject(solicitud.error || new Error('No se abrió IndexedDB'));
            });
            return this.dbPromise;
        },

        async guardar(registro) {
            if (!this.correo || !registro?.interaccionId) return;
            const dato = {
                ...registro,
                id: `${this.correo}|${registro.interaccionId}`,
                correo: this.correo,
                actualizadoISO: new Date().toISOString()
            };
            try {
                const db = await this.abrir();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.almacen, 'readwrite');
                    tx.objectStore(this.almacen).put(dato);
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            } catch (error) {
                this.guardarRespaldo(dato);
            }
        },

        guardarRespaldo(dato) {
            try {
                const clave = CLAVE_USUARIO('historial_interacciones_7d_respaldo');
                const lista = JSON.parse(localStorage.getItem(clave) || '[]').filter(item => item.id !== dato.id);
                lista.unshift(dato);
                localStorage.setItem(clave, JSON.stringify(lista.slice(0, 500)));
            } catch (error) {}
        },

        async listar() {
            let lista = [];
            try {
                const db = await this.abrir();
                lista = await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.almacen, 'readonly');
                    const req = tx.objectStore(this.almacen).index('correo').getAll(this.correo);
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
            } catch (error) {
                try { lista = JSON.parse(localStorage.getItem(CLAVE_USUARIO('historial_interacciones_7d_respaldo')) || '[]'); } catch (e) { lista = []; }
            }
            return lista.sort((a, b) => new Date(b.inicioISO || 0) - new Date(a.inicioISO || 0));
        },

        async limpiarVencidos() {
            const corte = Date.now() - (this.diasRetencion * 24 * 60 * 60 * 1000);
            try {
                const db = await this.abrir();
                await new Promise((resolve, reject) => {
                    const tx = db.transaction(this.almacen, 'readwrite');
                    const store = tx.objectStore(this.almacen);
                    const req = store.openCursor();
                    req.onsuccess = () => {
                        const cursor = req.result;
                        if (!cursor) return;
                        const item = cursor.value || {};
                        const referencia = new Date(item.finISO || item.inicioISO || 0).getTime();
                        if (!Number.isFinite(referencia) || referencia < corte) cursor.delete();
                        cursor.continue();
                    };
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            } catch (error) {}
            try {
                const clave = CLAVE_USUARIO('historial_interacciones_7d_respaldo');
                const lista = JSON.parse(localStorage.getItem(clave) || '[]');
                localStorage.setItem(clave, JSON.stringify(lista.filter(item => new Date(item.finISO || item.inicioISO || 0).getTime() >= corte)));
            } catch (error) {}
        }
    };

    // =========================================================================
    // 2. ESTADO GLOBAL
    // =========================================================================
    const STATE = {
        memoriaChats: {},
        eliminadosVoluntariamente: new Set(),
        scriptsPersonalizados: [],
        nombreAgente: "",
        clienteActualEnPantalla: null,
        clienteActualKey: null,
        ultimoClienteRenderizadoReloj: null,
        sistemaCargadoCompletamente: false,
        idUltimoMensajeCliente: "",
        sinChatsDesde: null,
        timeoutRevisionSinChats: null,
        timeoutSyncLlamadas: null,
        uidClientePendiente: "",
        uidClientePendienteHasta: 0,
        historialEmergencia: [],
        panelEmergenciaAbierto: false,
        ultimoTickCronometros: Date.now(),
        ultimoGuardadoCronometros: 0,
        _lastKeysStr: "FORCE_INITIAL_RENDER",

        // Módulo Llamadas
        modoLlamadasActivo: false,
        modoLlamadasAutomatico: false,
        scriptsDuranteLlamada: false,
        chatDisponibleAnterior: null,
        registroLlamadas: [],
        filtroMesLlamadas: "TODOS",
        filtroEstadoLlamadas: "TODOS",

        posReloj: { top: '25px', left: '340px', width: '300px', height: '80px' },
        posPanel: { bottom: '25px', left: '25px', top: 'auto', width: '300px', height: '360px' },
        posRespuestas: { top: '160px', left: '340px', width: '300px', height: '280px', minimizado: false },
        posBlocNotas: { top: '100px', left: '350px', width: '420px', height: '520px', minimizado: false },
        posBotonModo: { top: '12px', right: '20px', left: 'auto' },
        posKB: { top: '50%', left: 'auto', right: '0', width: '480px', height: '560px', minimizado: true, vista: 'inicio' },
        tema: 'oscuro',
        estiloVisual: 'verde',
        panelCronometrosVisible: true,
        vistaOperativaVisible: true,
        resultadosPaletaSuite: [],
        turnoActual: null,
        historial7Dias: [],
        mostrarHistorial7Dias: true,
        historialBusqueda: '',
        historialFiltroFecha: '',
        historialFiltroTipo: 'TODOS',
        historialFiltroEstado: 'TODOS',
        scrollSuiteActivoHasta: 0,
        timeoutRefrescoHistorial: null,
        inicioSincronizando: true,
        interfazInicializada: false,

        precargarInterfazLocal() {
            const cargar = (clave, fallback) => {
                try {
                    const guardado = localStorage.getItem(clave);
                    return guardado ? JSON.parse(guardado) : fallback;
                } catch (_) {
                    return fallback;
                }
            };
            const sesionAnterior = AUTH_MANAGER.obtenerSesionVisualLocal();
            const claveVisual = claveBase => sesionAnterior?.uid ? `${claveBase}__${sesionAnterior.uid}` : claveBase;

            // La precarga contiene solo apariencia y posiciones. Los scripts,
            // clientes y llamadas esperan la validación real de la cuenta.
            this.posReloj = cargar('pos_reloj_plata_v2', this.posReloj);
            this.posPanel = cargar('pos_panel_plata_v2', this.posPanel);
            this.posRespuestas = cargar('pos_respuestas_plata_v2', this.posRespuestas);
            this.posBlocNotas = cargar('pos_bloc_notas_plata_v1', this.posBlocNotas);
            this.posBotonModo = cargar('pos_btn_modo_plata_v1', this.posBotonModo);
            this.posKB = cargar('pos_herramientas_plata_v1', this.posKB);
            if (!['inicio', 'ultimos', 'tema', 'acerca'].includes(this.posKB.vista)) this.posKB.vista = 'inicio';
            const temaGuardado = localStorage.getItem(claveVisual('tema_suite_plata_v2')) || localStorage.getItem('tema_suite_plata_v1');
            this.tema = temaGuardado === 'claro' ? 'claro' : 'oscuro';
            const estiloGuardado = localStorage.getItem(claveVisual('estilo_visual_suite_plata_v1')) || 'verde';
            this.estiloVisual = PALETAS_VISUALES[estiloGuardado] ? estiloGuardado : 'verde';
            this.panelCronometrosVisible = localStorage.getItem('panel_cronometros_visible_plata_v1') !== 'false';
            this.vistaOperativaVisible = localStorage.getItem('vista_operativa_visible_plata_v1') !== 'false';
            this.nombreAgente = 'Agente';
            this.scriptsPersonalizados = [];
            this.memoriaChats = {};
            this.registroLlamadas = [];
            this._lastKeysStr = 'PRECARGA_VISUAL';
        },

        async cargarConfiguraciones() {
            await AUTH_MANAGER.inicializarObligatorio();
            INTERACCION_NORMAL.cargar();
            HISTORIAL_LOCAL.configurar(AUTH_MANAGER.usuario?.email || '');
            await HISTORIAL_LOCAL.limpiarVencidos();
            const cargar = (clave, fallback) => {
                try {
                    const guardado = localStorage.getItem(clave);
                    return guardado ? JSON.parse(guardado) : fallback;
                } catch { return fallback; }
            };
            const claveScripts = CLAVE_USUARIO('mis_scripts_agente_v2');
            const claveLlamadas = CLAVE_USUARIO('registro_llamadas_plata');
            const claveNombre = CLAVE_USUARIO('nombre_agente_plata');
            const claveHistorial = CLAVE_USUARIO('historial_emergencia_plata_v1');
            const claveHistorialBackup = CLAVE_USUARIO('historial_emergencia_plata_v1_backup');
            const tieneScriptsUsuario = localStorage.getItem(claveScripts) !== null;
            const tieneLlamadasUsuario = localStorage.getItem(claveLlamadas) !== null;
            const scriptsLegados = cargar('mis_scripts_agente_v2', null);
            const llamadasLegadas = cargar('registro_llamadas_plata', null);
            const historialLegado = cargar('historial_emergencia_plata_v1', null);

            this.posReloj = cargar('pos_reloj_plata_v2', this.posReloj);
            this.posPanel = cargar('pos_panel_plata_v2', this.posPanel);
            this.posRespuestas = cargar('pos_respuestas_plata_v2', this.posRespuestas);
            this.posBlocNotas = cargar('pos_bloc_notas_plata_v1', this.posBlocNotas);
            this.posBotonModo = cargar('pos_btn_modo_plata_v1', this.posBotonModo);
            this.posKB = cargar('pos_herramientas_plata_v1', this.posKB);
            if (!['inicio', 'ultimos', 'tema', 'acerca'].includes(this.posKB.vista)) this.posKB.vista = 'inicio';
            const temaGuardado = localStorage.getItem(CLAVE_USUARIO('tema_suite_plata_v2')) || localStorage.getItem('tema_suite_plata_v1');
            this.tema = temaGuardado === 'claro' ? 'claro' : 'oscuro';
            const estiloGuardado = localStorage.getItem(CLAVE_USUARIO('estilo_visual_suite_plata_v1')) || 'verde';
            this.estiloVisual = PALETAS_VISUALES[estiloGuardado] ? estiloGuardado : 'verde';
            // 84.10.22 consolida el motor preciso como único motor.
            localStorage.removeItem(CLAVE_USUARIO('motor_cronometros_prueba_v2'));
            this.panelCronometrosVisible = localStorage.getItem('panel_cronometros_visible_plata_v1') !== 'false';
            this.vistaOperativaVisible = localStorage.getItem('vista_operativa_visible_plata_v1') !== 'false';
            // 84.5 inaugura un ciclo limpio para impedir que una posición reutilizada
            // del CRM (task-tab-0, 1, 2...) herede el AHT de otro cliente.
            const versionCronometros = localStorage.getItem('version_cronometros_plata');
            if (versionCronometros === '84.5.0') {
                this.memoriaChats = cargar('cronometros_plata_card', {});
                this.eliminadosVoluntariamente = new Set(cargar('bloqueados_plata_card', []));
            } else {
                this.memoriaChats = {};
                this.eliminadosVoluntariamente = new Set();
                localStorage.removeItem('cronometros_plata_card');
                localStorage.removeItem('bloqueados_plata_card');
                localStorage.setItem('version_cronometros_plata', '84.5.0');
            }
            this.nombreAgente = localStorage.getItem(claveNombre) || AUTH_MANAGER.usuario?.displayName || String(AUTH_MANAGER.usuario?.email || '').split('@')[0] || 'Agente';
            localStorage.setItem(claveNombre, this.nombreAgente);
            // El modo se determina de nuevo en cada carga según las señales del CRM.
            // Así nunca queda bloqueado en llamadas por un estado antiguo.
            this.modoLlamadasActivo = false;
            this.modoLlamadasAutomatico = false;
            this.scriptsDuranteLlamada = false;
            localStorage.setItem('modo_llamadas_activo_plata', 'false');
            this.registroLlamadas = cargar(claveLlamadas, []);
            this.cargarTurnoActual(cargar);
            const respaldoEmergencia = cargar(claveHistorialBackup, []);
            this.historialEmergencia = cargar(claveHistorial, respaldoEmergencia);
            if (!Array.isArray(this.historialEmergencia)) this.historialEmergencia = [];
            this.historialEmergencia = this.historialEmergencia.slice(0, 3);

            this.scriptsPersonalizados = cargar(claveScripts, CONFIG.PLANTILLAS_BASE);

            // Ambas descargas se realizan en paralelo para no duplicar el tiempo
            // de espera cuando Firebase está lento o no está disponible.
            const [scriptsNube, llamadasNube] = await Promise.all([
                CLOUD_SYNC.descargarScripts(),
                CLOUD_SYNC.descargarLlamadasNube()
            ]);

            const hayLegadoPendiente = (!tieneScriptsUsuario && scriptsNube === null && Array.isArray(scriptsLegados) && scriptsLegados.length > 0) || (!tieneLlamadasUsuario && llamadasNube === null && Array.isArray(llamadasLegadas) && llamadasLegadas.length > 0);
            const debeMigrar = hayLegadoPendiente
                ? window.confirm(`Encontré scripts o llamadas guardados antes del inicio con Google.\n\n¿Pertenecen a ${AUTH_MANAGER.usuario.email} y deseas vincularlos a esta cuenta?`)
                : false;

            if (Array.isArray(scriptsNube) && scriptsNube.length > 0) {
                this.scriptsPersonalizados = scriptsNube;
            } else if (!tieneScriptsUsuario && debeMigrar && Array.isArray(scriptsLegados)) {
                this.scriptsPersonalizados = scriptsLegados;
            }
            try { localStorage.setItem(claveScripts, JSON.stringify(this.scriptsPersonalizados)); } catch(e) {}
            if (!(Array.isArray(scriptsNube) && scriptsNube.length > 0)) await CLOUD_SYNC.guardarScripts(this.scriptsPersonalizados);

            if (Array.isArray(llamadasNube)) {
                this.registroLlamadas = llamadasNube;
            } else if (!tieneLlamadasUsuario && debeMigrar && Array.isArray(llamadasLegadas)) {
                this.registroLlamadas = llamadasLegadas;
            }
            this.registroLlamadas = (Array.isArray(this.registroLlamadas) ? this.registroLlamadas : []).map(item => ({
                ...item,
                inicioISO: item.inicioISO || item.fechaISO || new Date().toISOString(),
                finISO: item.finISO || '',
                duracionSeg: Number(item.duracionSeg) || 0,
                tipo: item.tipo || 'LLAMADA',
                estado: item.estado || 'SIN_NOVEDAD',
                correoAgente: item.correoAgente || AUTH_MANAGER.usuario?.email || ''
            }));
            try { localStorage.setItem(claveLlamadas, JSON.stringify(this.registroLlamadas)); } catch (e) { console.error("Error guardando llamadas:", e); }
            if (!Array.isArray(llamadasNube)) await CLOUD_SYNC.guardarLlamadasNube(this.registroLlamadas);

            if (this.historialEmergencia.length === 0 && debeMigrar && Array.isArray(historialLegado)) {
                this.historialEmergencia = historialLegado.slice(0, 3);
            }
            this.guardarHistorialEmergencia();
            localStorage.setItem(CLAVE_USUARIO('migracion_google_completada'), '1');

            MOTOR_CRONOMETROS_V2.adoptarEstadoActual();
            this.ultimoTickCronometros = Date.now();
            this.ultimoGuardadoCronometros = Date.now();

            this.ejecutarAutolimpiezaIDs();
            await this.refrescarHistorialLocal();

            UI_MANAGER.inicializarEstructuraFijaRespuestas();
            UI_MANAGER.refrescarSoloTextosRespuestas();
        },

        cargarTurnoActual(cargar) {
            const turno = cargar(CLAVE_USUARIO('turno_operativo_v1'), null);
            if (turno && turno.estado === 'ACTIVO') {
                this.turnoActual = {
                    ...turno,
                    totalInteracciones: Number(turno.totalInteracciones) || 0,
                    finalizadas: Number(turno.finalizadas) || 0,
                    totalSegundos: Number(turno.totalSegundos) || 0,
                    idsRegistrados: Array.isArray(turno.idsRegistrados) ? turno.idsRegistrados.slice(-600) : [],
                    idsFinalizados: Array.isArray(turno.idsFinalizados) ? turno.idsFinalizados.slice(-600) : []
                };
            } else {
                this.turnoActual = null;
            }
        },

        crearTurno(fecha = new Date()) {
            const iso = fecha.toISOString();
            this.turnoActual = {
                id: `turno_${fecha.getTime()}`,
                inicioISO: iso,
                ultimaActividadISO: iso,
                finISO: '',
                estado: 'ACTIVO',
                totalInteracciones: 0,
                finalizadas: 0,
                totalSegundos: 0,
                idsRegistrados: [],
                idsFinalizados: []
            };
            this.guardarTurnoActual();
            return this.turnoActual;
        },

        guardarTurnoActual() {
            try {
                if (this.turnoActual) localStorage.setItem(CLAVE_USUARIO('turno_operativo_v1'), JSON.stringify(this.turnoActual));
                else localStorage.removeItem(CLAVE_USUARIO('turno_operativo_v1'));
            } catch (error) {
                console.warn('[Suite] No se pudo guardar el turno:', error);
            }
        },

        asegurarTurnoParaNuevaInteraccion(ahora = new Date(), interaccionNuevaId = '') {
            const limiteInactividad = 3 * 60 * 60 * 1000;
            const hayInteraccionesActivas = Object.values(this.memoriaChats || {}).some(chat => chat && !chat.finalizada && String(chat.interaccionId || '') !== String(interaccionNuevaId) && Date.now() - (Number(chat.ultimaVistaCRM) || 0) < 5000);
            if (this.turnoActual?.estado === 'ACTIVO') {
                const ultima = new Date(this.turnoActual.ultimaActividadISO || this.turnoActual.inicioISO).getTime();
                if (!hayInteraccionesActivas && Number.isFinite(ultima) && ahora.getTime() - ultima >= limiteInactividad) {
                    this.turnoActual.estado = 'FINALIZADO';
                    this.turnoActual.finISO = new Date(ultima).toISOString();
                    this.guardarTurnoActual();
                    this.turnoActual = null;
                }
            }
            return this.turnoActual || this.crearTurno(ahora);
        },

        registrarInicioInteraccion(claveChat, chat) {
            if (!chat) return;
            const interaccionId = String(chat.interaccionId || chat.taskId || chat.emergenciaId || claveChat);
            const turno = this.asegurarTurnoParaNuevaInteraccion(new Date(chat.inicioAHT || Date.now()), interaccionId);
            chat.interaccionId = interaccionId;
            chat.turnoId = turno.id;
            chat.tipoInteraccion = chat.tipoInteraccion || 'PENDIENTE';
            chat.estadoGestion = chat.estadoGestion || 'SIN_NOVEDAD';
            if (!turno.idsRegistrados.includes(interaccionId)) {
                turno.idsRegistrados.push(interaccionId);
                turno.idsRegistrados = turno.idsRegistrados.slice(-600);
                turno.totalInteracciones += 1;
            }
            turno.ultimaActividadISO = new Date().toISOString();
            this.guardarTurnoActual();
            this.guardarRegistroHistorial(chat, { finISO: '', duracionSeg: 0 });
            if (typeof UI_MANAGER !== 'undefined' && this.posKB.vista === 'inicio' && !this.posKB.minimizado) UI_MANAGER.renderizarInicioHerramientas();
        },

        actualizarTipoInteraccion(chat, tipo, forzar = false) {
            if (!chat || !['CHAT', 'LLAMADA'].includes(tipo) || (chat.tipoInteraccionBloqueado && !forzar)) return;
            chat.tipoInteraccion = tipo;
            chat.tipoInteraccionBloqueado = true;
            this.guardarRegistroHistorial(chat);
            const emergencia = this.historialEmergencia.find(item => item.taskId === chat.interaccionId || item.taskId === chat.emergenciaId);
            if (emergencia) {
                emergencia.tipoInteraccion = tipo;
                this.guardarHistorialEmergencia();
            }
        },

        construirRegistroHistorial(chat, extras = {}) {
            const inicioISO = new Date(chat.inicioAHT || Date.now()).toISOString();
            return {
                interaccionId: String(chat.interaccionId || chat.taskId || chat.emergenciaId || ''),
                turnoId: chat.turnoId || this.turnoActual?.id || '',
                tipo: chat.tipoInteraccion || 'PENDIENTE',
                cliente: chat.nombreCliente || 'Cliente sin nombre',
                idCliente: chat.uidCliente || '',
                inicioISO,
                finISO: chat.finISO || '',
                duracionSeg: Number(chat.duracionSeg) || 0,
                resultado: chat.resultado || '',
                estadoLlamada: chat.estadoLlamada || '',
                estadoGestion: chat.estadoGestion || (['SIN_NOVEDAD', 'SIN_JUSTIFICAR', 'JUSTIFICADO'].includes(chat.estadoLlamada) ? chat.estadoLlamada : 'SIN_NOVEDAD'),
                notas: chat.notasLlamada || '',
                estadoInteraccion: chat.finalizada ? 'FINALIZADA' : 'EN_CURSO',
                ...extras
            };
        },

        guardarRegistroHistorial(chat, extras = {}) {
            const registro = this.construirRegistroHistorial(chat, extras);
            if (!registro.interaccionId) return;
            HISTORIAL_LOCAL.guardar(registro).then(() => this.programarRefrescoHistorial()).catch(() => {});
        },

        programarRefrescoHistorial() {
            if (this.timeoutRefrescoHistorial) clearTimeout(this.timeoutRefrescoHistorial);
            this.timeoutRefrescoHistorial = setTimeout(() => {
                this.timeoutRefrescoHistorial = null;
                this.refrescarHistorialLocal();
            }, 250);
        },

        async refrescarHistorialLocal() {
            this.historial7Dias = await HISTORIAL_LOCAL.listar();
            if (typeof UI_MANAGER !== 'undefined' && this.posKB.vista === 'ultimos' && !this.posKB.minimizado) {
                const listaVisible = document.getElementById('suite-historial-lista');
                const editandoTarjeta = document.activeElement?.closest?.('#suite-historial-lista');
                if (listaVisible && (Date.now() < this.scrollSuiteActivoHasta || editandoTarjeta)) {
                    if (this.timeoutRefrescoHistorial) clearTimeout(this.timeoutRefrescoHistorial);
                    this.timeoutRefrescoHistorial = setTimeout(() => {
                        this.timeoutRefrescoHistorial = null;
                        this.refrescarHistorialLocal();
                    }, 700);
                } else if (listaVisible) {
                    UI_MANAGER.actualizarListaHistorial(true);
                } else {
                    UI_MANAGER.renderizarUltimosHerramientas();
                }
            }
        },

        actualizarRegistroHistorial(interaccionId, cambios = {}) {
            const id = String(interaccionId || '');
            if (!id) return;
            const indice = this.historial7Dias.findIndex(item => String(item.interaccionId || '') === id);
            if (indice < 0) return;

            const actual = this.historial7Dias[indice];
            const actualizado = {
                ...actual,
                ...cambios,
                estadoGestion: cambios.estadoGestion || actual.estadoGestion || 'SIN_NOVEDAD'
            };
            this.historial7Dias[indice] = actualizado;
            HISTORIAL_LOCAL.guardar(actualizado).catch(() => {});

            const chat = Object.values(this.memoriaChats || {}).find(item => String(item?.interaccionId || '') === id);
            if (chat) {
                if (Object.prototype.hasOwnProperty.call(cambios, 'resultado')) chat.resultado = cambios.resultado;
                if (Object.prototype.hasOwnProperty.call(cambios, 'estadoGestion')) chat.estadoGestion = cambios.estadoGestion;
                if (Object.prototype.hasOwnProperty.call(cambios, 'notas')) chat.notasLlamada = cambios.notas;
                this.guardarEnDisco();
            }

            const llamada = this.registroLlamadas.find(item => String(item.interaccionId || '') === id);
            if (llamada) {
                if (Object.prototype.hasOwnProperty.call(cambios, 'estadoGestion')) llamada.estado = cambios.estadoGestion;
                if (Object.prototype.hasOwnProperty.call(cambios, 'notas')) llamada.notas = cambios.notas;
                this.guardarLlamadasDisco();
            }

            const emergencia = this.historialEmergencia.find(item => String(item.taskId || '') === id);
            if (emergencia && Object.prototype.hasOwnProperty.call(cambios, 'resultado')) {
                emergencia.resultado = cambios.resultado;
                this.guardarHistorialEmergencia();
            }
        },

        finalizarInteraccion(claveChat, motivo = 'CRM_FINALIZADA', momentoFin = null) {
            const chat = this.memoriaChats[claveChat];
            if (!chat || chat.finalizada) return;
            if (chat.registroPendiente) {
                chat.registroPendiente = false;
                this.registrarInicioInteraccion(claveChat, chat);
            }
            const finDetectado = Number(momentoFin);
            const ahora = Number.isFinite(finDetectado) && finDetectado > 0 ? finDetectado : Date.now();
            chat.finalizada = true;
            chat.finISO = new Date(ahora).toISOString();
            chat.duracionSeg = Math.max(0, Math.round((ahora - (Number(chat.inicioAHT) || ahora)) / 1000));
            chat.resultado = chat.resultado || motivo;
            if (!chat.tipoInteraccionBloqueado) this.actualizarTipoInteraccion(chat, 'CHAT');

            const turno = this.turnoActual;
            if (turno?.estado === 'ACTIVO' && chat.turnoId === turno.id && !turno.idsFinalizados.includes(chat.interaccionId)) {
                turno.idsFinalizados.push(chat.interaccionId);
                turno.idsFinalizados = turno.idsFinalizados.slice(-600);
                turno.finalizadas += 1;
                turno.totalSegundos += chat.duracionSeg;
                turno.ultimaActividadISO = chat.finISO;
                this.guardarTurnoActual();
            }

            if (chat.tipoInteraccion === 'LLAMADA') {
                this.finalizarLlamadaAutomatica(chat);
                const otraLlamada = Object.values(this.memoriaChats || {}).some(item => item && item !== chat && !item.finalizada && item.tipoInteraccion === 'LLAMADA' && !item.llamadaFinalizada);
                if (!otraLlamada && typeof UI_MANAGER !== 'undefined' && this.modoLlamadasAutomatico) UI_MANAGER.establecerModoLlamadas(false, true);
            }
            this.guardarRegistroHistorial(chat);
            const emergencia = this.historialEmergencia.find(item => item.taskId === chat.interaccionId || item.taskId === chat.emergenciaId);
            if (emergencia) {
                emergencia.finISO = chat.finISO;
                emergencia.duracionSeg = chat.duracionSeg;
                emergencia.tipoInteraccion = chat.tipoInteraccion;
                emergencia.resultado = chat.resultado;
                this.guardarHistorialEmergencia();
            }
            if (typeof UI_MANAGER !== 'undefined') {
                if (this.posKB.vista === 'inicio' && !this.posKB.minimizado) UI_MANAGER.renderizarInicioHerramientas();
                if (this.posKB.vista === 'ultimos' && !this.posKB.minimizado) UI_MANAGER.actualizarListaHistorial(true);
            }
        },

        iniciarLlamadaAutomatica(chat) {
            if (!chat || chat.registroLlamadaId) return;
            const uid = chat.uidCliente || UTILS.extraerUIDClienteActual() || this.obtenerUIDPendiente();
            const inicio = new Date(chat.inicioAHT || Date.now());
            const llamada = {
                id: `call_auto_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                interaccionId: chat.interaccionId,
                tipo: 'LLAMADA',
                cliente: chat.nombreCliente || this.clienteActualEnPantalla || 'Cliente General',
                horaEntrada: inicio.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                fechaISO: inicio.toISOString(),
                inicioISO: inicio.toISOString(),
                finISO: '',
                duracionSeg: 0,
                idLlamada: uid || '',
                notas: '',
                estado: 'EN_CURSO',
                correoAgente: AUTH_MANAGER.usuario?.email || ''
            };
            chat.registroLlamadaId = llamada.id;
            chat.estadoLlamada = 'EN_CURSO';
            chat.estadoGestion = chat.estadoGestion || 'SIN_NOVEDAD';
            this.registroLlamadas.unshift(llamada);
            this.guardarLlamadasDisco();
        },

        finalizarLlamadaAutomatica(chat) {
            if (!chat?.registroLlamadaId) return;
            const llamada = this.registroLlamadas.find(item => item.id === chat.registroLlamadaId);
            if (!llamada || llamada.estado !== 'EN_CURSO') return;
            const fin = new Date(chat.finLlamadaISO || chat.finISO || Date.now());
            llamada.finISO = fin.toISOString();
            llamada.duracionSeg = Math.max(0, Math.round((fin.getTime() - new Date(llamada.inicioISO || llamada.fechaISO).getTime()) / 1000));
            llamada.estado = 'SIN_NOVEDAD';
            chat.estadoLlamada = 'SIN_NOVEDAD';
            chat.estadoGestion = 'SIN_NOVEDAD';
            this.guardarLlamadasDisco();
        },

        sincronizarLlamadaConHistorial(llamada) {
            if (!llamada?.interaccionId) return;
            const chat = Object.values(this.memoriaChats || {}).find(item => item?.interaccionId === llamada.interaccionId);
            if (chat) {
                chat.estadoLlamada = llamada.estado;
                if (['SIN_NOVEDAD', 'SIN_JUSTIFICAR', 'JUSTIFICADO'].includes(llamada.estado)) chat.estadoGestion = llamada.estado;
                chat.notasLlamada = llamada.notas || '';
                chat.uidCliente = llamada.idLlamada || chat.uidCliente || '';
                this.guardarRegistroHistorial(chat);
                return;
            }
            const existente = this.historial7Dias.find(item => item.interaccionId === llamada.interaccionId) || {};
            HISTORIAL_LOCAL.guardar({
                ...existente,
                interaccionId: llamada.interaccionId,
                turnoId: existente.turnoId || '',
                tipo: 'LLAMADA',
                cliente: llamada.cliente || existente.cliente || 'Cliente',
                idCliente: llamada.idLlamada || existente.idCliente || '',
                inicioISO: llamada.inicioISO || llamada.fechaISO || existente.inicioISO,
                finISO: llamada.finISO || existente.finISO || '',
                duracionSeg: Number(llamada.duracionSeg) || Number(existente.duracionSeg) || 0,
                resultado: existente.resultado || '',
                estadoLlamada: llamada.estado || '',
                estadoGestion: ['SIN_NOVEDAD', 'SIN_JUSTIFICAR', 'JUSTIFICADO'].includes(llamada.estado) ? llamada.estado : (existente.estadoGestion || 'SIN_NOVEDAD'),
                notas: llamada.notas || '',
                estadoInteraccion: llamada.finISO ? 'FINALIZADA' : 'EN_CURSO'
            }).then(() => this.programarRefrescoHistorial());
        },

        finalizarTurnoManual() {
            const activas = Object.values(this.memoriaChats || {}).filter(chat => chat && !chat.finalizada);
            if (activas.length) {
                UI_MANAGER.mostrarToast('Finaliza las interacciones activas antes de cerrar el turno');
                return false;
            }
            if (!this.turnoActual) {
                UI_MANAGER.mostrarToast('Todavía no hay un turno activo');
                return false;
            }
            this.turnoActual.estado = 'FINALIZADO';
            this.turnoActual.finISO = new Date().toISOString();
            this.turnoActual.ultimaActividadISO = this.turnoActual.finISO;
            this.guardarTurnoActual();
            this.turnoActual = null;
            UI_MANAGER.renderizarInicioHerramientas();
            UI_MANAGER.mostrarToast('Turno finalizado');
            return true;
        },

        obtenerTodasLasPlantillas() {
            return this.scriptsPersonalizados;
        },

        obtenerUIDPendiente() {
            if (this.uidClientePendiente && Date.now() <= this.uidClientePendienteHasta) {
                return this.uidClientePendiente;
            }
            this.uidClientePendiente = "";
            this.uidClientePendienteHasta = 0;
            return "";
        },

        limpiarUIDPendiente() {
            this.uidClientePendiente = "";
            this.uidClientePendienteHasta = 0;
        },

        registrarUIDDetectado(uid) {
            if (!uid) return false;

            // Conserva el UID durante cinco minutos por si el agente primero lo
            // copia y después registra la llamada.
            this.uidClientePendiente = uid;
            this.uidClientePendienteHasta = Date.now() + (5 * 60 * 1000);

            const chatActual = this.memoriaChats[this.clienteActualKey];
            if (chatActual?.emergenciaId) {
                chatActual.uidCliente = uid;
                this.registrarInteraccionEmergencia(
                    chatActual.interaccionId || chatActual.emergenciaId,
                    this.clienteActualEnPantalla || chatActual.nombreCliente,
                    uid
                );
                this.guardarRegistroHistorial(chatActual);
            }

            const ahora = Date.now();
            const nombreActual = UTILS.pointerNormalizer(this.clienteActualEnPantalla || '').toLowerCase();
            const pendientesRecientes = this.registroLlamadas.filter(item => {
                if (item.idLlamada) return false; // Nunca sobrescribe IDs existentes.
                const creado = new Date(item.fechaISO).getTime();
                return Number.isFinite(creado) && ahora - creado <= 10 * 60 * 1000;
            });

            const porNombre = nombreActual
                ? pendientesRecientes.find(item =>
                    UTILS.pointerNormalizer(item.cliente || '').toLowerCase() === nombreActual
                )
                : null;

            // Si no hay coincidencia por nombre, únicamente usa una llamada creada
            // en los últimos dos minutos para evitar vincular registros antiguos.
            const muyReciente = pendientesRecientes.find(item => {
                const creado = new Date(item.fechaISO).getTime();
                return ahora - creado <= 2 * 60 * 1000;
            });

            const llamadaObjetivo = porNombre || muyReciente;
            if (!llamadaObjetivo) return false;

            llamadaObjetivo.idLlamada = uid;
            this.limpiarUIDPendiente();
            this.guardarLlamadasDisco();
            if (DOM.blocNotas && this.modoLlamadasActivo) {
                UI_MANAGER.renderizarContenidoBlocNotas();
            }
            return true;
        },

        guardarHistorialEmergencia() {
            try {
                const datos = JSON.stringify(this.historialEmergencia.slice(0, 3));
                localStorage.setItem(CLAVE_USUARIO('historial_emergencia_plata_v1'), datos);
                localStorage.setItem(CLAVE_USUARIO('historial_emergencia_plata_v1_backup'), datos);
            } catch (e) {
                console.error('[Suite] No se pudo guardar el respaldo de emergencia:', e);
            }
        },

        registrarInteraccionEmergencia(registroId, nombreCliente, uidCliente = '') {
            if (!registroId) return;
            const idSeguro = String(registroId).trim();
            const nombreSeguro = String(nombreCliente || 'Cliente sin nombre').trim();
            const uidSeguro = String(uidCliente || '').trim();
            const existente = this.historialEmergencia.find(item => item.taskId === idSeguro);
            let huboCambio = false;

            if (existente) {
                if (nombreSeguro && existente.nombreCliente !== nombreSeguro) {
                    existente.nombreCliente = nombreSeguro;
                    huboCambio = true;
                }
                if (uidSeguro && existente.uidCliente !== uidSeguro) {
                    existente.uidCliente = uidSeguro;
                    huboCambio = true;
                }
                if (huboCambio) this.guardarHistorialEmergencia();
            } else {
                this.historialEmergencia.unshift({
                    taskId: idSeguro,
                    nombreCliente: nombreSeguro,
                    uidCliente: uidSeguro,
                    llegadaISO: new Date().toISOString(),
                    finISO: '',
                    duracionSeg: 0,
                    tipoInteraccion: 'PENDIENTE',
                    justificada: false
                });
                this.historialEmergencia = this.historialEmergencia.slice(0, 3);
                this.guardarHistorialEmergencia();
                huboCambio = true;
            }

            if (huboCambio && typeof UI_MANAGER !== 'undefined') {
                UI_MANAGER.actualizarBotonEmergencia();
                if (this.posKB.vista === 'ultimos' && !this.posKB.minimizado) UI_MANAGER.actualizarListaHistorial(true);
            }
        },

        marcarInteraccionJustificada(taskId) {
            const item = this.historialEmergencia.find(registro => registro.taskId === taskId);
            if (!item) return;
            item.justificada = !item.justificada;
            this.guardarHistorialEmergencia();
            if (this.posKB.vista === 'ultimos' && !this.posKB.minimizado) UI_MANAGER.actualizarListaHistorial(true);
            UI_MANAGER.actualizarBotonEmergencia();
        },

        async guardarNombreAgente(nombre) {
            this.nombreAgente = nombre;
            localStorage.setItem(CLAVE_USUARIO('nombre_agente_plata'), nombre);
            STATE._lastKeysStr = "FORCE_REFRESH_NAME";
            UI_MANAGER.actualizarPanelLateral();

            const scriptsExistentes = await CLOUD_SYNC.descargarScripts();
            if (scriptsExistentes && Array.isArray(scriptsExistentes) && scriptsExistentes.length > 0) {
                this.scriptsPersonalizados = scriptsExistentes;
                localStorage.setItem(CLAVE_USUARIO('mis_scripts_agente_v2'), JSON.stringify(this.scriptsPersonalizados));
                UI_MANAGER.inicializarEstructuraFijaRespuestas();
                UI_MANAGER.refrescarSoloTextosRespuestas();
            } else {
                CLOUD_SYNC.guardarScripts(this.scriptsPersonalizados);
            }
        },

        guardarScriptsPersonalizados(nuevosScripts) {
            this.scriptsPersonalizados = nuevosScripts;
            try {
                localStorage.setItem(CLAVE_USUARIO('mis_scripts_agente_v2'), JSON.stringify(this.scriptsPersonalizados));
            } catch(e) {}
            CLOUD_SYNC.guardarScripts(this.scriptsPersonalizados);
        },

        guardarEnDisco() {
            try {
                localStorage.setItem('cronometros_plata_card', JSON.stringify(this.memoriaChats));
                localStorage.setItem('bloqueados_plata_card', JSON.stringify(Array.from(this.eliminadosVoluntariamente)));
            } catch (e) {
                console.error("Error guardando configuraciones:", e);
            }
        },

        guardarLlamadasDisco() {
            try {
                localStorage.setItem(CLAVE_USUARIO('registro_llamadas_plata'), JSON.stringify(this.registroLlamadas));
            } catch (e) {
                console.error("Error guardando llamadas localmente:", e);
            }
            // El guardado local es inmediato; la nube espera una pausa breve para
            // evitar una solicitud por cada tecla escrita en las notas.
            if (this.timeoutSyncLlamadas) clearTimeout(this.timeoutSyncLlamadas);
            this.timeoutSyncLlamadas = setTimeout(() => {
                this.timeoutSyncLlamadas = null;
                CLOUD_SYNC.guardarLlamadasNube(this.registroLlamadas);
            }, 1200);
        },

        ejecutarAutolimpiezaIDs() {
            const HORA_EN_MS = 7 * 24 * 60 * 60 * 1000;
            const ahora = Date.now();
            let huboCambios = false;

            this.registroLlamadas.forEach(item => {
                if (item.estado === 'SIN_JUSTIFICAR') {
                    const timestampCreacion = new Date(item.fechaISO).getTime();
                    if (ahora - timestampCreacion > HORA_EN_MS) {
                        item.idLlamada = ""; // Se borra el ID automáticamente tras 1 semana si no se justificó
                        huboCambios = true;
                    }
                }
            });

            if (huboCambios) this.guardarLlamadasDisco();
        }
    };

    const DOM = {
        reloj: null,
        panel: null,
        ventana: null,
        estilo: null,
        inputArea: null,
        btnModoLlamadas: null,
        blocNotas: null,
        btnEmergencia: null,
        panelEmergencia: null,
        kb: null
    };

    // =========================================================================
    // DIAGNÓSTICO LIGERO Y MEMORIA DE ELEMENTOS DEL CRM
    // =========================================================================
    const RENDIMIENTO = {
        solicitudesVisuales: 0,
        cuadrosVisuales: 0,
        actualizacionesAgrupadas: 0,
        renderizados: 0,
        tiempoRenderTotal: 0,
        tiempoRenderMaximo: 0,
        recuperacionesVentanas: 0,
        erroresInternos: 0,
        ultimoError: '',

        medir(nombre, operacion) {
            const inicio = performance.now();
            try {
                return operacion();
            } catch (error) {
                this.erroresInternos += 1;
                this.ultimoError = `${nombre}: ${error?.message || error}`;
                console.warn(`[Sistema Dual] ${nombre}:`, error);
                return undefined;
            } finally {
                const duracion = performance.now() - inicio;
                this.renderizados += 1;
                this.tiempoRenderTotal += duracion;
                this.tiempoRenderMaximo = Math.max(this.tiempoRenderMaximo, duracion);
            }
        },

        resumen() {
            const promedio = this.renderizados ? this.tiempoRenderTotal / this.renderizados : 0;
            const totalCache = CRM_CACHE.aciertos + CRM_CACHE.renovaciones;
            const porcentajeCache = totalCache ? Math.round((CRM_CACHE.aciertos / totalCache) * 100) : 0;
            const estado = this.erroresInternos > 0 || promedio >= 16
                ? { texto:'Revisar', color:'#f59e0b' }
                : { texto:'Estable', color:'#34d399' };
            return {
                promedio,
                maximo: this.tiempoRenderMaximo,
                porcentajeCache,
                estado,
                pausas: MOTOR_CRONOMETROS_V2?.estadisticas?.pausasRecuperadas || 0
            };
        },

        actualizarVista() {
            const raiz = document.getElementById('suite-medidor-rendimiento');
            if (!raiz) return;
            const datos = this.resumen();
            const escribir = (id, valor) => {
                const elemento = document.getElementById(id);
                if (elemento && elemento.textContent !== String(valor)) elemento.textContent = String(valor);
            };
            escribir('suite-rend-estado', datos.estado.texto);
            const estado = document.getElementById('suite-rend-estado');
            if (estado) estado.style.color = datos.estado.color;
            escribir('suite-rend-promedio', `${datos.promedio.toFixed(2)} ms`);
            escribir('suite-rend-maximo', `${datos.maximo.toFixed(2)} ms`);
            escribir('suite-rend-cola', this.actualizacionesAgrupadas);
            escribir('suite-rend-cache', `${datos.porcentajeCache}%`);
            escribir('suite-rend-pausas', datos.pausas);
            escribir('suite-rend-ventanas', this.recuperacionesVentanas);
            escribir('suite-rend-error', this.ultimoError || 'Ninguno');
        }
    };

    const CRM_CACHE = {
        registros: new Map(),
        aciertos: 0,
        renovaciones: 0,

        obtener(clave, selector, duracionMs, forzar = false) {
            const ahora = performance.now();
            const anterior = this.registros.get(clave);
            if (!forzar && anterior && ahora - anterior.creadoEn <= duracionMs) {
                const conectados = anterior.elementos.filter(elemento => elemento?.isConnected);
                if (conectados.length === anterior.elementos.length) {
                    this.aciertos += 1;
                    return conectados;
                }
            }
            const elementos = Array.from(document.querySelectorAll(selector));
            this.registros.set(clave, { elementos, creadoEn: ahora });
            this.renovaciones += 1;
            return elementos;
        },

        pestanas(forzar = false) {
            return this.obtener('pestanas', '[data-testid*="task-tab-"]', 600, forzar);
        },

        camposChat(forzar = false) {
            return this.obtener('campos-chat', 'textarea[data-testid="chat-message-input"]', 350, forzar);
        },

        mensajes(forzar = false) {
            return this.obtener('mensajes', 'ch-message-v2, [data-testid="chat-message"]', 300, forzar);
        },

        elementosUID(forzar = false) {
            return this.obtener('uid', '[data-testid="debug-uid"]', 800, forzar);
        },

        invalidar(...claves) {
            if (!claves.length) this.registros.clear();
            else claves.forEach(clave => this.registros.delete(clave));
        }
    };

    // =========================================================================
    // 3. AUDIO Y UTILS
    // =========================================================================
    const AUDIO_ENGINE = {
        ctx: null,
        ultimosEventos: new Map(),
        obtenerContexto() {
            if (!this.ctx) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (AudioContext) this.ctx = new AudioContext();
            }
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => {});
            }
            return this.ctx;
        },
        reproducir(tipo, contexto = {}) {
            try {
                if (tipo !== 'pinata') {
                    if (!STATE.sistemaCargadoCompletamente) return;
                    const chat = contexto.chat;
                    if (chat && (chat.finalizada || chat.ocultoTemporal || !chat.ultimaVistaCRM || Date.now() - chat.ultimaVistaCRM > 2200)) return;
                    const claveEvento = String(contexto.evento || '');
                    if (claveEvento) {
                        const firma = `${tipo}:${claveEvento}`;
                        const ultima = Number(this.ultimosEventos.get(firma) || 0);
                        if (Date.now() - ultima < 1800) return;
                        this.ultimosEventos.set(firma, Date.now());
                        if (this.ultimosEventos.size > 80) {
                            const corte = Date.now() - 60000;
                            for (const [clave, fecha] of this.ultimosEventos) if (fecha < corte) this.ultimosEventos.delete(clave);
                        }
                    }
                }
                const ctx = this.obtenerContexto();
                if (!ctx) return;
                const tiempoActual = ctx.currentTime;

                if (tipo === 'notificacion') {
                    this.crearTono(ctx, 1046.50, 0.08, tiempoActual, 0.1);
                    this.crearTono(ctx, 1318.51, 0.1, tiempoActual + 0.04, 0.25);
                } else if (tipo === 'urgente') {
                    this.crearTono(ctx, 783.99, 0.07, tiempoActual, 0.3);
                    this.crearTono(ctx, 523.25, 0.09, tiempoActual + 0.12, 0.85);
                } else if (tipo === 'pinata') {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'triangle';
                    osc.frequency.setValueAtTime(150, tiempoActual);
                    osc.frequency.exponentialRampToValueAtTime(40, tiempoActual + 0.08);
                    gain.gain.setValueAtTime(0.4, tiempoActual);
                    gain.gain.exponentialRampToValueAtTime(0.001, tiempoActual + 0.08);
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.start(tiempoActual);
                    osc.stop(tiempoActual + 0.08);

                    const notas = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98];
                    notas.forEach((frec, index) => {
                        const retraso = tiempoActual + 0.03 + (index * 0.025);
                        this.crearTono(ctx, frec, 0.12 - (index * 0.015), retraso, 0.06);
                    });
                }
            } catch (e) {}
        },
        crearTono(ctx, frec, vol, inicio, duracion) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(frec, inicio);
            gain.gain.setValueAtTime(vol, inicio);
            gain.gain.exponentialRampToValueAtTime(0.001, inicio + duracion);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(inicio);
            osc.stop(inicio + duracion);
        }
    };

    const UTILS = {
        idsMensajesPorNodo: new WeakMap(),
        secuenciaMensaje: 0,
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        obtenerSaludoPorHora() {
            const hora = new Date().getHours();
            if (hora >= 12 && hora < 19) return "Buena tarde";
            if (hora >= 19 || hora < 6) return "Buena noche";
            return "Buen día";
        },
        formatearTiempo(segundosTotales) {
            const totalSeguro = Math.max(0, Number(segundosTotales) || 0);
            const mins = Math.floor(totalSeguro / 60);
            const segs = parseInt(totalSeguro % 60, 10);
            return `${mins}:${segs < 10 ? '0' : ''}${segs}`;
        },
        escaparRegex(texto) {
            return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        },
        escaparHTML(texto) {
            return String(texto ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        },
        esTextareaChat(elemento) {
            return !!(elemento && elemento.matches && elemento.matches('textarea[data-testid="chat-message-input"]'));
        },
        obtenerIdMensaje(nodo, texto = '', contexto = {}) {
            if (nodo && nodo.getAttribute) {
                const idReal = nodo.getAttribute('data-message-id') ||
                    nodo.getAttribute('data-id') ||
                    nodo.getAttribute('data-testid-message-id') ||
                    nodo.id ||
                    nodo.querySelector?.('[data-message-id],[data-testid-message-id]')?.getAttribute('data-message-id') ||
                    nodo.querySelector?.('[data-testid-message-id]')?.getAttribute('data-testid-message-id') || '';
                if (idReal) return `crm_${idReal}`;
            }

            const firmaNodo = String([
                nodo?.getAttribute?.('aria-label'),
                nodo?.getAttribute?.('title'),
                nodo?.className,
                texto
            ].filter(Boolean).join(' '));
            const esAudio = Boolean(contexto.esAudio)
                || Boolean(nodo?.querySelector?.('audio,[role="slider"],[aria-label*="audio" i],[aria-label*="reproduc" i],[class*="wave" i]'))
                || /transcribiendo|reproducción|velocidad\s*1(?:[.,]0)?x/i.test(firmaNodo);
            if (esAudio) {
                const hora = String(texto || '').match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0] || '';
                const firmaAudio = `${contexto.claveChat || ''}|${Number(contexto.indice ?? -1)}|${hora}|audio`;
                let hashAudio = 2166136261;
                for (let i = 0; i < firmaAudio.length; i++) {
                    hashAudio ^= firmaAudio.charCodeAt(i);
                    hashAudio = Math.imul(hashAudio, 16777619);
                }
                return `audio_${(hashAudio >>> 0).toString(36)}`;
            }

            if (nodo && typeof nodo === 'object') {
                const existente = this.idsMensajesPorNodo.get(nodo);
                if (existente && !String(texto || '').trim()) return existente;
                if (!String(texto || '').trim()) {
                    const nuevo = `nodo_${++this.secuenciaMensaje}`;
                    this.idsMensajesPorNodo.set(nodo, nuevo);
                    return nuevo;
                }
            }

            // Respaldo estable cuando el CRM no publica un ID de mensaje.
            const contenido = String(texto || '');
            let hash = 2166136261;
            for (let i = 0; i < contenido.length; i++) {
                hash ^= contenido.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            return `texto_${contenido.length}_${(hash >>> 0).toString(36)}`;
        },
        textToClean(text) {
            if (!text) return '';
            // La primera línea corresponde al nombre; no se eliminan números porque
            // pueden formar parte de nombres reales como "Empresa 360".
            return text.split('\n')[0].replace(/<!---->+/g, '').trim();
        },
        pointerNormalizer(text) {
            if (!text) return '';
            return text.replace(/[^\p{L}\p{N}\s]/gu, '').trim();
        },
        extraerTaskId(nodo) {
            if (!nodo) return '';
            let tid = nodo.getAttribute('data-task-id') || nodo.getAttribute('data-id') || nodo.getAttribute('data-ticket-id') || '';
            if (!tid) {
                const testId = nodo.getAttribute('data-testid') || '';
                const matchTestId = testId.match(/task-tab-(.+)$/);
                if (matchTestId) tid = matchTestId[1];
            }
            if (!tid) {
                const link = nodo.querySelector('a[href*="/tasks/"]');
                if (link) {
                    const match = link.href.match(/\/tasks\/(\d+)/);
                    if (match) tid = match[1];
                }
            }
            if (!tid && nodo.id) {
                tid = nodo.id.replace(/[^0-9]/g, '');
            }
            return tid ? tid.replace(/^chat-?/, '') : '';
        },
        identidadesPestanas: new WeakMap(),
        secuenciaAnonimos: 0,
        obtenerClaveChat(pestaña, nombreCliente, ocurrencia = 1) {
            const enlace = this.identidadesPestanas.get(pestaña);
            if (enlace?.clave) return enlace.clave;
            const nombreSeguro = this.pointerNormalizer(nombreCliente || '').toLowerCase();
            // La identidad se basa en el nombre y su ocurrencia visible. Los números
            // 0, 1 y 2 del CRM son posiciones reutilizables y nunca se usan como ID.
            return `cliente:${nombreSeguro}|instancia:${Math.max(1, ocurrencia)}`;
        },
        obtenerNombrePestanaChat(pestaña) {
            const nombre = this.leerNombrePestanaChat(pestaña);
            if (nombre) return nombre;
            let enlace = this.identidadesPestanas.get(pestaña);
            if (!enlace) {
                enlace = { clave: `anonimo:${Date.now()}:${++this.secuenciaAnonimos}` };
                this.identidadesPestanas.set(pestaña, enlace);
            }
            return STATE.memoriaChats[enlace.clave]?.nombreCliente || 'Cliente sin nombre';
        },
        leerNombrePestanaChat(pestaña) {
            if (!pestaña) return '';
            const textoOriginal = pestaña.querySelector('.text-nowrap, .text-ellipsis');
            if (textoOriginal) return this.textToClean(textoOriginal.innerText || textoOriginal.textContent || '');

            // Excluye el tiempo añadido por la suite para que nunca forme parte
            // del nombre ni cambie la identidad de la interacción.
            const copia = pestaña.cloneNode(true);
            copia.querySelectorAll('.suite-cronometro-chat-integrado').forEach(el => el.remove());
            const texto = this.textToClean(copia.textContent || '');
            return /\p{L}/u.test(texto) ? texto : '';
        },
        extraerUIDClienteActual() {
            const elementos = CRM_CACHE.elementosUID();
            if (elementos.length === 0) return '';

            const elementoVisible = elementos.find(el => el.offsetParent !== null) || elementos[0];
            const texto = (elementoVisible.textContent || '').trim();
            const uuid = texto.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
            if (uuid) return uuid[0];

            // Respaldo por si el CRM cambia el formato pero conserva la etiqueta UID.
            return texto.replace(/^UID\s*/i, '').trim();
        },
        esPestanaActiva(pestaña) {
            if (!pestaña) return false;
            const ariaSelected = pestaña.getAttribute('aria-selected');
            if (ariaSelected === 'true') return true;
            if (pestaña.getAttribute('data-state') === 'active') return true;
            if (pestaña.classList.contains('active')) return true;
            if (ariaSelected !== 'false' && !pestaña.classList.contains('bg-neutral')) return true;

            // Con una sola interacción el CRM puede omitir el estado visual
            // "active" aunque el chat central esté abierto. El campo editable
            // confirma que esa única pestaña es la conversación atendida.
            const pestañas = CRM_CACHE.pestanas();
            if (pestañas.length === 1 && pestañas[0] === pestaña) {
                const campo = CRM_CACHE.camposChat().find(elemento => {
                    const rect = elemento.getBoundingClientRect();
                    const estilo = getComputedStyle(elemento);
                    return rect.width > 0
                        && rect.height > 0
                        && estilo.display !== 'none'
                        && estilo.visibility !== 'hidden'
                        && !elemento.disabled
                        && !elemento.readOnly
                        && elemento.getAttribute('aria-disabled') !== 'true';
                });
                if (campo) return true;
            }
            return false;
        },
        procesarTextoScript(textoPlantilla, clienteNombre) {
            let nombreLimpio = (clienteNombre || 'Cliente').split(' ')[0];
            nombreLimpio = nombreLimpio.charAt(0).toUpperCase() + this.textToClean(nombreLimpio.slice(1).toLowerCase());
            const saludo = this.obtenerSaludoPorHora();
            return textoPlantilla
                .replace(/\[SALUDO_TEMPORAL\]|\[SALUDO\]/g, saludo)
                .replace(/X{3,5}/g, nombreLimpio);
        },
        animarEfectoPinata(targetEl) {
            AUDIO_ENGINE.reproducir('pinata');

            if (!targetEl) return;
            const rect = targetEl.getBoundingClientRect();
            const posX = rect.left + (rect.width / 2);
            const posY = rect.top + (rect.height / 2);

            const emojisFiesta = ['🪅', '🎉', '🥳', '🎊', '✨', '💥', '🍬', '🍭', '⚡', '⭐'];
            const emojiElegido = emojisFiesta[Math.floor(Math.random() * emojisFiesta.length)];

            const badge = document.createElement('div');
            badge.innerText = emojiElegido;
            badge.style.cssText = `
                position: fixed; top: ${posY - 10}px; left: ${posX}px;
                transform: translate(-50%, -50%) scale(0.5);
                background: rgba(15, 23, 42, 0.85);
                border: 1px solid rgba(16, 185, 129, 0.8);
                font-size: 20px;
                padding: 6px 12px; border-radius: 50px;
                box-shadow: 0 0 20px rgba(16, 185, 129, 0.6);
                z-index: 999999999; pointer-events: none; opacity: 0;
                transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            `;
            document.body.appendChild(badge);

            requestAnimationFrame(() => {
                badge.style.opacity = '1';
                badge.style.transform = `translate(-50%, -55px) scale(1.3)`;
            });

            setTimeout(() => {
                badge.style.opacity = '0';
                badge.style.transform = `translate(-50%, -80px) scale(0.8)`;
                setTimeout(() => badge.remove(), 300);
            }, 600);

            const fragmentoConfeti = document.createDocumentFragment();
            const partículas = [];
            const colores = ['#10b981', '#38bdf8', '#f59e0b', '#ec4899', '#a855f7', '#34d399'];

            for (let i = 0; i < 12; i++) {
                const p = document.createElement('div');
                const color = colores[Math.floor(Math.random() * colores.length)];
                p.style.cssText = `
                    position: fixed; top: ${posY}px; left: ${posX}px;
                    width: ${Math.random() * 6 + 4}px; height: ${Math.random() * 6 + 4}px;
                    background-color: ${color}; border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
                    z-index: 999999999; pointer-events: none; opacity: 1;
                    transition: transform 0.6s cubic-bezier(0.1, 0.8, 0.3, 1), opacity 0.6s ease;
                `;
                fragmentoConfeti.appendChild(p);
                partículas.push(p);
            }
            document.body.appendChild(fragmentoConfeti);

            requestAnimationFrame(() => {
                partículas.forEach(p => {
                    const destX = (Math.random() - 0.5) * 160;
                    const destY = (Math.random() - 0.5) * 160 - 20;
                    p.style.transform = `translate(${destX}px, ${destY}px) rotate(${Math.random() * 360}deg)`;
                    p.style.opacity = '0';
                });
            });

            setTimeout(() => partículas.forEach(p => p.remove()), 650);
        }
    };

    // =========================================================================
    // 4. UI MANAGER
    // =========================================================================
    const UI_MANAGER = {
        inicializar() {
            if (!document.body) return;
            if (STATE.interfazInicializada) return;
            STATE.interfazInicializada = true;
            document.body.classList.add('plata-suite-premium');
            this.inyectarEstilosGlobales();
            this.aplicarVariablesPaleta();
            this.crearBotonModoLlamadas();
            this.crearReloj();
            this.crearPanelControl();
            this.crearPanelRespuestas();
            this.crearPanelKB();
            this.crearPanelBlocNotasLlamadas();
            this.enlazarEventosGlobales();
            this.enlazarDetectorComandos();

            if (!STATE.nombreAgente) {
                setTimeout(() => this.pedirNombreInicialModal(), 600);
            }

            this.actualizarVisibilidadPorModo();
            this.aplicarTemaVisual();
            const recuperarAlRedimensionar = UTILS.debounce(() => this.recuperarVentanasFueraDeVista(), 160);
            window.addEventListener('resize', recuperarAlRedimensionar, { passive:true });
            window.visualViewport?.addEventListener('resize', recuperarAlRedimensionar, { passive:true });
            setTimeout(() => this.recuperarVentanasFueraDeVista(), 250);
        },

        mostrarEstadoArranque(texto = 'Sincronizando sesión…') {
            if (!document.body) return;
            let indicador = document.getElementById('suite-estado-arranque-plata');
            if (!indicador) {
                indicador = document.createElement('div');
                indicador.id = 'suite-estado-arranque-plata';
                indicador.style.cssText = 'position:fixed!important;top:12px!important;left:50%!important;transform:translateX(-50%)!important;z-index:2147483645!important;display:flex!important;align-items:center!important;gap:7px!important;padding:7px 11px!important;border:1px solid var(--sd-borde,rgba(45,212,191,.28))!important;border-radius:999px!important;background:var(--sd-panel-bg,rgba(15,23,42,.96))!important;color:var(--sd-texto,#f8fafc)!important;box-shadow:0 10px 28px rgba(15,23,42,.22)!important;font:700 8px/1.2 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;letter-spacing:.04em!important;pointer-events:none!important;opacity:1!important;transition:opacity .18s ease,transform .18s ease!important;';
                indicador.innerHTML = '<span style="width:7px;height:7px;border-radius:50%;background:var(--sd-acento,#10b981);box-shadow:0 0 0 4px var(--sd-acento-suave,rgba(16,185,129,.13));"></span><span data-suite-estado-texto></span>';
                document.body.appendChild(indicador);
            }
            const etiqueta = indicador.querySelector('[data-suite-estado-texto]');
            if (etiqueta) etiqueta.textContent = texto;
        },

        ocultarEstadoArranque() {
            const indicador = document.getElementById('suite-estado-arranque-plata');
            if (!indicador) return;
            indicador.style.setProperty('opacity', '0', 'important');
            indicador.style.setProperty('transform', 'translateX(-50%) translateY(-5px)', 'important');
            setTimeout(() => indicador.remove(), 190);
        },

        sincronizarInterfazCargada() {
            this.aplicarVariablesPaleta();
            this.aplicarTemaVisual();
            this.renderizarKB();
            this.inicializarEstructuraFijaRespuestas();
            this.actualizarVisibilidadPorModo();
            STATE._lastKeysStr = 'SINCRONIZACION_COMPLETA';
            COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio', 'historial', 'rendimiento');
            requestAnimationFrame(() => this.recuperarVentanasFueraDeVista());
        },

        actualizarBotonEmergencia() {
            const btn = document.getElementById('btn-emergencia-chats-plata');
            if (!btn) return;
            DOM.btnEmergencia = btn;
            const total = STATE.historialEmergencia.length;
            const sinConexion = navigator.onLine === false;
            btn.style.setProperty(
                'background',
                sinConexion
                    ? 'linear-gradient(135deg, #b91c1c, #7f1d1d)'
                    : 'linear-gradient(135deg, #f59e0b, #b45309)',
                'important'
            );
            btn.innerHTML = `🛟 Últimos ${total}`;
            btn.title = sinConexion
                ? 'Sin conexión · abrir respaldo de chats'
                : `Abrir respaldo de los últimos ${total} chats`;
        },

        togglePanelEmergencia() {
            STATE.panelEmergenciaAbierto = !STATE.panelEmergenciaAbierto;
            if (!STATE.panelEmergenciaAbierto) {
                document.getElementById('panel-emergencia-chats-plata')?.remove();
                DOM.panelEmergencia = null;
                return;
            }
            this.renderizarPanelEmergencia();
        },

        async copiarTextoEmergencia(texto) {
            try {
                await navigator.clipboard.writeText(texto);
                return true;
            } catch (e) {
                try {
                    const temporal = document.createElement('textarea');
                    temporal.value = texto;
                    temporal.style.cssText = 'position:fixed;left:-9999px;top:-9999px;';
                    document.body.appendChild(temporal);
                    temporal.select();
                    const copiado = document.execCommand('copy');
                    temporal.remove();
                    return copiado;
                } catch (error) {
                    console.warn('[Suite] No se pudo copiar el respaldo:', error);
                    return false;
                }
            }
        },

        renderizarPanelEmergencia() {
            if (!STATE.panelEmergenciaAbierto || !document.body) return;
            let panel = document.getElementById('panel-emergencia-chats-plata');
            if (!panel) {
                panel = document.createElement('div');
                panel.id = 'panel-emergencia-chats-plata';
                document.body.appendChild(panel);
            }
            DOM.panelEmergencia = panel;
            panel.style.cssText = `
                position: fixed !important; right: 58px !important; top: 50% !important;
                transform: translateY(-50%) !important; z-index: 2147483646 !important;
                width: 390px !important; max-width: calc(100vw - 75px) !important;
                max-height: 82vh !important; overflow: hidden !important;
                background: var(--sd-panel-bg) !important; color: var(--sd-texto) !important;
                border: 1px solid var(--sd-borde) !important; border-radius: 16px !important;
                box-shadow: var(--sd-sombra) !important;
                font-family: 'Inter', -apple-system, sans-serif !important;
                padding: 14px !important; box-sizing: border-box !important;
            `;

            const filas = STATE.historialEmergencia.length === 0
                ? `<div style="padding:22px;text-align:center;color:#94a3b8;font-size:11px;">Todavía no hay chats respaldados.</div>`
                : STATE.historialEmergencia.map((item, indice) => {
                    const fecha = new Date(item.llegadaISO);
                    const hora = Number.isNaN(fecha.getTime())
                        ? 'Hora no disponible'
                        : fecha.toLocaleString('es-MX', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit', second: '2-digit'
                        });
                    const nombre = UTILS.escaparHTML(item.nombreCliente);
                    const taskId = UTILS.escaparHTML(item.taskId);
                    const uid = UTILS.escaparHTML(item.uidCliente || 'Pendiente de detectar');
                    const fin = item.finISO ? new Date(item.finISO) : null;
                    const finTexto = fin && !Number.isNaN(fin.getTime()) ? fin.toLocaleString('es-MX', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}) : 'En curso';
                    const inicioMs = fecha.getTime();
                    const duracion = Number(item.duracionSeg) || (Number.isFinite(inicioMs) ? Math.max(0, Math.round((Date.now() - inicioMs) / 1000)) : 0);
                    return `
                        <div style="border:1px solid rgba(245,158,11,.42);background:rgba(255,255,255,.035);border-radius:11px;padding:10px;margin-bottom:8px;">
                            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:7px;">
                                <span style="font-size:11px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${indice + 1}. ${nombre}</span>
                            </div>
                            <div style="font-size:9px;color:#94a3b8;margin-bottom:5px;">Llegó: <b style="color:#e2e8f0;">${UTILS.escaparHTML(hora)}</b></div>
                            <div style="font-size:9px;color:#94a3b8;margin-bottom:5px;">Finalizó: <b style="color:${item.finISO ? '#e2e8f0' : '#34d399'};">${UTILS.escaparHTML(finTexto)}</b> · ${UTILS.formatearTiempo(duracion)}</div>
                            <div style="font-size:9px;color:#94a3b8;margin-bottom:8px;word-break:break-all;">ID: <b style="color:#c4b5fd;">${uid}</b></div>
                            <button data-emergencia-action="copiar-id" data-task-id="${taskId}" ${item.uidCliente ? '' : 'disabled'} style="background:${item.uidCliente ? '#6d28d9' : '#334155'};color:white;border:0;border-radius:6px;padding:6px 9px;font-size:9px;cursor:${item.uidCliente ? 'pointer' : 'not-allowed'};">Copiar ID</button>
                        </div>`;
                }).join('');

            panel.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:9px;margin-bottom:10px;">
                    <div><div style="font-size:12px;font-weight:900;color:#fbbf24;">🛟 RESPALDO DE EMERGENCIA</div><div style="font-size:9px;color:#94a3b8;margin-top:2px;">Últimas 3 interacciones detectadas</div></div>
                    <button data-emergencia-action="cerrar" style="background:transparent;border:0;color:#cbd5e1;font-size:16px;cursor:pointer;">✕</button>
                </div>
                <div class="suite-scroll-plata" style="overflow-y:auto;max-height:calc(82vh - 105px);padding-right:2px;">${filas}</div>
            `;

            panel.onclick = async (e) => {
                const boton = e.target.closest('[data-emergencia-action]');
                if (!boton) return;
                e.preventDefault();
                e.stopPropagation();
                const accion = boton.getAttribute('data-emergencia-action');
                const taskIdRaw = boton.getAttribute('data-task-id') || '';
                const item = STATE.historialEmergencia.find(registro => registro.taskId === taskIdRaw);

                if (accion === 'cerrar') {
                    STATE.panelEmergenciaAbierto = false;
                    panel.remove();
                    DOM.panelEmergencia = null;
                } else if (accion === 'copiar-id' && item?.uidCliente) {
                    await this.copiarTextoEmergencia(item.uidCliente);
                }
            };
        },

        asegurarUIEmergencia() {
            if (!document.body) return;
            if (!document.getElementById('ventana-kb-plata')) {
                DOM.kb = null;
                this.crearPanelKB();
            } else if (STATE.posKB.minimizado) {
                this.posicionarAccesoSuperior();
            }
        },

        crearBotonModoLlamadas() {
            if (document.getElementById("btn-toggle-modo-llamadas")) return;
            DOM.btnModoLlamadas = document.createElement('button');
            DOM.btnModoLlamadas.id = "btn-toggle-modo-llamadas";
            DOM.btnModoLlamadas.style.cssText = `
                position: fixed !important; z-index: 999999999 !important;
                background: var(--sd-panel-bg) !important; color: var(--sd-texto) !important;
                border: 1px solid var(--sd-borde) !important; padding: 9px 14px !important; border-radius: 15px !important;
                font-family: 'Inter', -apple-system, sans-serif !important; font-size: 10px !important; font-weight: 800 !important;
                box-shadow: 0 14px 34px rgba(15,23,42,.24), inset 0 1px rgba(255,255,255,.065) !important; cursor: pointer !important; transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease, color .18s ease !important;
                display: flex !important; align-items: center !important; gap: 6px !important; user-select: none !important;
            `;
            this.actualizarBotonVistaOperativa();
            this.aplicarDimensionesBotonModo();
            document.body.appendChild(DOM.btnModoLlamadas);

            this.hacerArrastrable(DOM.btnModoLlamadas, 'pos_btn_modo_plata_v1', 'botonModo');

            let fueArrastrado = false;
            DOM.btnModoLlamadas.addEventListener('mousedown', () => { fueArrastrado = false; });
            DOM.btnModoLlamadas.addEventListener('mousemove', () => { fueArrastrado = true; });
            DOM.btnModoLlamadas.onclick = (e) => {
                if (fueArrastrado) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                this.alternarVistaOperativa();
            };
        },

        actualizarBotonVistaOperativa() {
            const btn = DOM.btnModoLlamadas;
            if (!btn) return;
            const visible = STATE.scriptsDuranteLlamada;
            btn.innerHTML = visible ? `▦ Paneles activos` : `▦ Vista operativa`;
            btn.title = visible
                ? 'Ocultar scripts y cronómetro global'
                : 'Mostrar scripts y cronómetro global durante la llamada';
            btn.setAttribute('aria-pressed', String(visible));
            btn.style.setProperty('display', STATE.modoLlamadasActivo ? 'flex' : 'none', 'important');
            btn.style.setProperty('color', visible ? 'var(--sd-acento-contraste)' : 'var(--sd-texto)', 'important');
            btn.style.setProperty('border-color', visible ? 'var(--sd-acento)' : 'var(--sd-borde)', 'important');
            btn.style.setProperty('background', visible
                ? 'var(--sd-boton-activo-bg)'
                : 'var(--sd-panel-bg)', 'important');
        },

        alternarVistaOperativa() {
            if (!STATE.modoLlamadasActivo) return;
            STATE.scriptsDuranteLlamada = !STATE.scriptsDuranteLlamada;
            this.actualizarVisibilidadPorModo();
            this.mostrarToast(STATE.scriptsDuranteLlamada
                ? 'Scripts y cronómetro activados durante la llamada'
                : 'Paneles de apoyo ocultos · los tiempos continúan');
        },

        aplicarDimensionesBotonModo() {
            const btn = DOM.btnModoLlamadas;
            if (!btn) return;
            btn.style.setProperty('top', STATE.posBotonModo.top, 'important');
            if (STATE.posBotonModo.left && STATE.posBotonModo.left !== 'auto') {
                btn.style.setProperty('left', STATE.posBotonModo.left, 'important');
                btn.style.setProperty('right', 'auto', 'important');
            } else {
                btn.style.setProperty('right', STATE.posBotonModo.right || '20px', 'important');
                btn.style.setProperty('left', 'auto', 'important');
            }
        },

        toggleModoLlamadas() {
            const hayLlamadaReal = Object.values(STATE.memoriaChats || {}).some(chat => chat && chat.tipoInteraccion === 'LLAMADA' && !chat.llamadaFinalizada && !chat.finalizada);
            if (STATE.modoLlamadasActivo && (STATE.modoLlamadasAutomatico || hayLlamadaReal)) {
                // Mientras la llamada siga activa, el botón no debe sacar al agente
                // del módulo ni forzar una vista de chat inexistente. La disponibilidad
                // del chat se determina exclusivamente con los controles reales del CRM.
                this.sincronizarDisponibilidadChatDuranteLlamada();
                this.renderizarContenidoBlocNotas();
                return;
            }
            this.establecerModoLlamadas(!STATE.modoLlamadasActivo, false);
        },

        establecerModoLlamadas(activo, automatico = true) {
            const nuevoEstado = Boolean(activo);
            if (nuevoEstado) {
                const panelExistente = document.getElementById('panel-bloc-notas-llamadas');
                if (!panelExistente) this.crearPanelBlocNotasLlamadas();
                else if (!DOM.blocNotas) DOM.blocNotas = panelExistente;
            }
            if (STATE.modoLlamadasActivo === nuevoEstado) {
                if (nuevoEstado) this.renderizarContenidoBlocNotas();
                return;
            }
            STATE.modoLlamadasActivo = nuevoEstado;
            STATE.modoLlamadasAutomatico = automatico;
            STATE.scriptsDuranteLlamada = false;
            STATE.chatDisponibleAnterior = null;
            localStorage.setItem('modo_llamadas_activo_plata', JSON.stringify(nuevoEstado));
            this.actualizarVisibilidadPorModo();
        },

        obtenerCampoChatEditable() {
            const visible = elemento => {
                if (!elemento) return false;
                const rect = elemento.getBoundingClientRect();
                const estilo = getComputedStyle(elemento);
                return rect.width > 0 && rect.height > 0 && estilo.display !== 'none' && estilo.visibility !== 'hidden';
            };
            return CRM_CACHE.camposChat().find(campo =>
                visible(campo)
                && !campo.disabled
                && !campo.readOnly
                && campo.getAttribute('aria-disabled') !== 'true'
            ) || null;
        },

        hayChatDisponibleParaScripts() {
            const visible = elemento => {
                if (!elemento) return false;
                const rect = elemento.getBoundingClientRect();
                const estilo = getComputedStyle(elemento);
                return rect.width > 0 && rect.height > 0 && estilo.display !== 'none' && estilo.visibility !== 'hidden';
            };
            const hayPestana = CRM_CACHE.pestanas().some(visible);
            return Boolean(hayPestana && this.obtenerCampoChatEditable());
        },

        sincronizarDisponibilidadChatDuranteLlamada() {
            if (!STATE.modoLlamadasActivo) {
                STATE.chatDisponibleAnterior = null;
                return;
            }
            const disponible = this.hayChatDisponibleParaScripts();
            if (STATE.chatDisponibleAnterior === disponible) return;
            STATE.chatDisponibleAnterior = disponible;
            this.actualizarVisibilidadPorModo();
        },

        actualizarVisibilidadPorModo() {
            if (STATE.modoLlamadasActivo) {
                const mostrarScripts = STATE.scriptsDuranteLlamada;
                if (DOM.reloj) DOM.reloj.style.setProperty('display', mostrarScripts ? 'block' : 'none', 'important');
                if (DOM.panel) DOM.panel.style.setProperty('display', 'none', 'important');
                if (DOM.ventana) DOM.ventana.style.setProperty('display', mostrarScripts ? 'block' : 'none', 'important');

                if (DOM.blocNotas) DOM.blocNotas.style.setProperty('display', 'block', 'important');
                this.actualizarBotonVistaOperativa();
                this.renderizarContenidoBlocNotas();
                if (mostrarScripts) COLA_VISUAL.solicitar('reloj', 'respuestas', 'pestanas');
            } else {
                STATE.scriptsDuranteLlamada = false;
                if (DOM.blocNotas) DOM.blocNotas.style.setProperty('display', 'none', 'important');
                this.aplicarVisibilidadPanelCronometros();
                if (DOM.ventana) DOM.ventana.style.setProperty('display', 'block', 'important');

                this.actualizarBotonVistaOperativa();
                COLA_VISUAL.solicitar('reloj', 'respuestas', 'pestanas');
            }
            requestAnimationFrame(() => this.recuperarVentanasFueraDeVista());
        },

        pedirNombreInicialModal() {
            if (document.getElementById("modal-bienvenida-apodo-plata")) return;

            const modal = document.createElement('div');
            modal.id = "modal-bienvenida-apodo-plata";
            modal.style = `
                position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important;
                background: rgba(15, 23, 42, 0.82) !important; backdrop-filter: blur(10px) !important;
                z-index: 999999999 !important; display: flex !important; align-items: center !important; justify-content: center !important;
                font-family: 'Inter', -apple-system, sans-serif !important;
            `;

            modal.innerHTML = `
                <div style="background:var(--sd-panel-bg);border:1px solid var(--sd-borde);border-radius:16px;width:310px;padding:20px;box-shadow:var(--sd-sombra);color:var(--sd-texto);text-align:center;box-sizing:border-box;">
                    <div style="font-size: 26px; margin-bottom: 6px;">👋</div>
                    <h3 style="margin:0 0 6px;font-size:14px;font-weight:bold;color:var(--sd-acento);">¡Bienvenido/a a la Suite!</h3>
                    <p style="margin: 0 0 14px 0; font-size: 11px; color: #94a3b8; line-height: 1.4;">Por favor, ingresa tu <b>Nombre y Apellido</b> para personalizar tu panel de trabajo:</p>
                    <input id="input-nombre-apellido-inicial" type="text" placeholder="Ej. Carlos Pérez" style="width:100%;background:var(--sd-campo);border:1px solid var(--sd-borde);color:var(--sd-texto);padding:10px;border-radius:8px;font-size:12px;margin-bottom:12px;box-sizing:border-box;text-align:center;outline:none;" />
                    <button id="btn-guardar-nombre-inicial" style="width:100%;background:linear-gradient(145deg,var(--sd-acento2),var(--sd-acento));border:none;color:var(--sd-tinta-acento);padding:9px;border-radius:8px;font-size:11px;font-weight:bold;cursor:pointer;transition:filter .2s;">
                        Comenzar 🚀
                    </button>
                </div>
            `;

            document.body.appendChild(modal);

            const input = document.getElementById('input-nombre-apellido-inicial');
            const btn = document.getElementById('btn-guardar-nombre-inicial');
            if (input) input.focus();

            const guardar = async () => {
                const val = input.value.trim();
                if (val) {
                    await STATE.guardarNombreAgente(val);
                    modal.remove();
                } else {
                    input.style.borderColor = '#ef4444';
                }
            };

            btn.onclick = guardar;
            input.onkeydown = (e) => { if (e.key === 'Enter') guardar(); };
        },

        inyectarEstilosGlobales() {
            if (document.getElementById("estilo-alerta-plata")) return;
            DOM.estilo = document.createElement('style');
            DOM.estilo.id = "estilo-alerta-plata";
            DOM.estilo.innerHTML = `
                @keyframes parpadeoRojoPremium {
                    0%, 100% { border-color: rgba(248,113,113,.62); box-shadow: 0 18px 46px rgba(2,8,18,.38), 0 0 0 0 rgba(239,68,68,.18) !important; }
                    50% { border-color: rgba(248,113,113,.34); box-shadow: 0 18px 46px rgba(2,8,18,.38), 0 0 0 7px rgba(239,68,68,0) !important; }
                }
                .alerta-activa-plata { animation: parpadeoRojoPremium 2s infinite ease-in-out !important; }
                @keyframes entradaPremiumDiagonalInversa {
                    0% { opacity: 0; transform: translateY(8px) scale(.985); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                .animar-entrada-premium { animation: entradaPremiumDiagonalInversa .28s cubic-bezier(.2,.8,.2,1) forwards !important; }
                @keyframes plataExecutiveEntrada {
                    from { opacity:0; transform:translateY(9px) scale(.985); }
                    to { opacity:1; transform:translateY(0) scale(1); }
                }
                .tarjeta-chat-premium {
                    display: flex !important; flex-direction: column !important; gap: 4px !important; cursor: pointer !important; box-sizing: border-box !important;
                    background: rgba(255, 255, 255, 0.06) !important; opacity: 1 !important; border: 1px solid rgba(190, 207, 226, 0.16) !important;
                    transition: transform .18s ease, border-color .18s ease, background-color .18s ease, box-shadow .18s ease !important;
                }
                .tarjeta-chat-premium:hover {
                    transform: translateY(-1px) !important; background: rgba(255, 255, 255, 0.085) !important; border-color: rgba(94, 234, 212, 0.32) !important; box-shadow: 0 8px 22px rgba(15,23,42,.16) !important;
                }
                [data-testid*="task-tab-"].suite-chat-con-cronometro {
                    position: relative !important;
                    padding-right: 70px !important;
                    box-sizing: border-box !important;
                }
                .suite-cronometro-chat-integrado {
                    position: absolute !important;
                    right: 11px !important;
                    top: 50% !important;
                    transform: translateY(-50%) !important;
                    min-width: 45px !important;
                    height: 24px !important;
                    padding: 0 7px !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    box-sizing: border-box !important;
                    border-radius: 9px !important;
                    border: 1px solid rgba(16, 185, 129, 0.20) !important;
                    background: rgba(15, 23, 42, 0.07) !important;
                    color: #059669 !important;
                    font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
                    letter-spacing: -0.03em !important;
                    pointer-events: none !important;
                    white-space: nowrap !important;
                    text-align: center !important;
                    z-index: 2 !important;
                    transition: color .2s ease, background-color .2s ease, border-color .2s ease !important;
                }
                .suite-cronometro-chat-integrado.respuesta { color:#7c3aed !important; border-color:rgba(124,58,237,.24) !important; background:rgba(124,58,237,.08) !important; }
                .suite-cronometro-chat-integrado.bienvenida { color:#0284c7 !important; border-color:rgba(2,132,199,.24) !important; background:rgba(2,132,199,.08) !important; }
                .suite-cronometro-chat-integrado.aviso { color:#d97706 !important; border-color:rgba(217,119,6,.25) !important; background:rgba(245,158,11,.10) !important; }
                .suite-cronometro-chat-integrado.urgente { color:#dc2626 !important; border-color:rgba(220,38,38,.27) !important; background:rgba(239,68,68,.10) !important; }
                [data-testid*="task-tab-"][aria-selected="true"] .suite-cronometro-chat-integrado,
                [data-testid*="task-tab-"][data-state="active"] .suite-cronometro-chat-integrado {
                    box-shadow: 0 3px 10px rgba(15,23,42,.10) !important;
                }
                .btn-plantilla-premium {
                    background: rgba(255, 255, 255, 0.06) !important; border: 1px solid rgba(190,207,226,.16) !important;
                    color: #edf4fb !important; padding: 10px 13px !important; border-radius: 13px !important; font-size: 11px !important; font-weight: 500 !important; text-align: left !important;
                    cursor: pointer !important; display: block !important; width: 100% !important; margin-bottom: 6px !important; box-sizing: border-box !important;
                    transition: transform .18s ease, background-color .18s ease, border-color .18s ease, box-shadow .18s ease !important;
                }
                .btn-plantilla-premium:hover:not([disabled]) {
                    background: rgba(62,229,188,.14) !important; color: #ffffff !important; border-color: rgba(94,234,212,.34) !important; transform: translateX(2px) !important; box-shadow:0 7px 18px rgba(15,23,42,.14) !important;
                }
                #panel-cronometros-plata::-webkit-scrollbar, #contenedor-scroll-respuestas::-webkit-scrollbar, #lista-scripts-personalizados::-webkit-scrollbar, #scroll-llamadas::-webkit-scrollbar { width: 5px !important; }
                #panel-cronometros-plata::-webkit-scrollbar-thumb, #contenedor-scroll-respuestas::-webkit-scrollbar-thumb, #lista-scripts-personalizados::-webkit-scrollbar-thumb, #scroll-llamadas::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.6) !important; border-radius: 10px !important; }
                .vista-previa-tema-panel-plata {
                    position:fixed !important;
                    z-index:2147483646 !important;
                    margin:0 !important;
                    transform:none !important;
                    pointer-events:none !important;
                    overflow:hidden !important;
                    box-sizing:border-box !important;
                    will-change:clip-path !important;
                    contain:paint !important;
                }
                .vista-previa-tema-panel-plata, .vista-previa-tema-panel-plata * { pointer-events:none !important; }
                #reloj-automatico-plata, #panel-cronometros-plata, #ventana-respuestas-plata,
                #ventana-kb-plata, #panel-bloc-notas-llamadas {
                    transition: background-color .22s ease, border-color .22s ease, color .22s ease, box-shadow .22s ease !important;
                    animation: plataExecutiveEntrada .28s cubic-bezier(.2,.8,.2,1) both;
                }
                #btn-toggle-modo-llamadas:hover {
                    transform: translateY(-1px) !important;
                    color:#f3f7fb !important;
                    border-color:rgba(32,211,163,.32) !important;
                    box-shadow:0 17px 42px rgba(15,23,42,.26), inset 0 1px rgba(255,255,255,.07) !important;
                }
                #btn-toggle-modo-llamadas:active { transform:translateY(0) scale(.985) !important; }
                #reloj-automatico-plata { font-variant-numeric:tabular-nums; }
                #ventana-respuestas-plata, #panel-cronometros-plata, #panel-bloc-notas-llamadas, #ventana-kb-plata {
                    overflow:hidden !important;
                }
                body.plata-tema-claro .tarjeta-chat-premium,
                body.plata-tema-claro #ventana-respuestas-plata .btn-plantilla-premium,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-ultimo-chat-plata,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-tema-plata,
                body.plata-tema-claro #panel-bloc-notas-llamadas .tarjeta-llamada-plata {
                    background: rgba(255,255,255,.8) !important;
                    color: #172033 !important;
                    border-color: rgba(14,165,233,.28) !important;
                }
                body.plata-tema-claro #panel-cronometros-plata .tarjeta-chat-premium span,
                body.plata-tema-claro #ventana-respuestas-plata .btn-plantilla-premium,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-ultimo-chat-plata,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-tema-plata,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-ultimo-chat-plata div,
                body.plata-tema-claro #ventana-kb-plata .tarjeta-ultimo-chat-plata b,
                body.plata-tema-claro #panel-bloc-notas-llamadas .tarjeta-llamada-plata span {
                    color: #172033 !important;
                }
                body.plata-tema-claro #panel-bloc-notas-llamadas input,
                body.plata-tema-claro #panel-bloc-notas-llamadas textarea,
                body.plata-tema-claro #panel-bloc-notas-llamadas select {
                    background: rgba(255,255,255,.9) !important;
                    color: #172033 !important;
                    border-color: rgba(14,165,233,.3) !important;
                }
                body.plata-tema-claro #ventana-kb-plata .herramienta-tab-plata {
                    background: rgba(255,255,255,.76) !important;
                    color: #334155 !important;
                    border-color: rgba(14,165,233,.22) !important;
                }
                body.plata-tema-claro #ventana-kb-plata .herramienta-tab-plata.activo {
                    background: rgba(14,165,233,.16) !important;
                    color: #075985 !important;
                    border-color: rgba(14,165,233,.55) !important;
                }
                .suite-marca-plata { display:flex;align-items:center;gap:10px;min-width:0; }
                .suite-logo-plata { width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:linear-gradient(145deg,#48e6bd,#18c99a);color:#04110d;font-size:11px;font-weight:950;letter-spacing:-.04em;box-shadow:0 9px 24px rgba(24,201,154,.22);flex:0 0 auto; }
                .suite-eyebrow-plata { font-size:8px;font-weight:850;letter-spacing:.18em;text-transform:uppercase;color:#71e7c7; }
                .suite-titulo-plata { margin-top:3px;font-size:13px;font-weight:950;letter-spacing:.02em;color:#f7faff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                .suite-chip-plata { display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(190,207,226,.19);border-radius:999px;padding:4px 7px;background:rgba(255,255,255,.065);font-size:8px;font-weight:850;color:#dce7f3;white-space:nowrap; }
                .suite-punto-plata { width:6px;height:6px;border-radius:50%;background:#20d3a3;box-shadow:0 0 0 3px rgba(32,211,163,.11); }
                .suite-punto-plata.aviso { background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.12); }
                .suite-punto-plata.bloqueado { background:#64748b;box-shadow:0 0 0 3px rgba(100,116,139,.16); }
                .suite-nav-plata { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px;padding:10px 0; }
                .suite-tab-plata { position:relative;min-width:0;background:rgba(255,255,255,.05);color:#b9c7d8;border:1px solid transparent;border-radius:10px;padding:8px 3px;font-size:9px;font-weight:850;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease,color .18s ease; }
                .suite-tab-plata:hover { transform:translateY(-1px);background:rgba(255,255,255,.08);border-color:rgba(190,207,226,.19);color:#f3f7fb; }
                .suite-tab-plata.activo { background:rgba(62,229,188,.15);color:#e1fff6;border-color:rgba(94,234,212,.30);box-shadow:none; }
                .suite-tab-plata.activo::after { content:'';position:absolute;left:22%;right:22%;bottom:-1px;height:2px;border-radius:99px;background:#20d3a3;box-shadow:0 -3px 12px rgba(32,211,163,.24); }
                .suite-resumen-grid-plata { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px; }
                .suite-metrica-plata { position:relative;overflow:hidden;border:1px solid rgba(190,207,226,.17);border-radius:16px;padding:13px;background:rgba(255,255,255,.058);min-height:72px;box-sizing:border-box;transition:transform .18s ease,border-color .18s ease,background .18s ease; }
                button.suite-metrica-plata:hover { transform:translateY(-1px);border-color:rgba(94,234,212,.30);background:rgba(255,255,255,.085); }
                .suite-metrica-plata::after { content:'';position:absolute;width:52px;height:52px;border-radius:50%;right:-23px;bottom:-25px;background:var(--suite-acento,rgba(45,212,191,.12)); }
                .suite-metrica-etiqueta { color:#b6c5d7;font-size:8px;font-weight:850;letter-spacing:.08em;text-transform:uppercase; }
                .suite-metrica-valor { color:#ffffff;font-size:20px;line-height:1;margin-top:8px;font-weight:950;letter-spacing:-.04em; }
                .suite-metrica-detalle { color:#b6c5d7;font-size:8px;margin-top:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                .suite-tarjeta-plata { border:1px solid rgba(190,207,226,.16);border-radius:16px;padding:13px;background:rgba(255,255,255,.052); }
                .suite-boton-plata { display:inline-flex;align-items:center;justify-content:center;gap:6px;background:linear-gradient(145deg,#20d3a3,#109678);color:#04110d;border:1px solid rgba(82,231,191,.28);border-radius:11px;padding:8px 11px;font-size:9px;font-weight:900;cursor:pointer;transition:transform .18s ease,filter .18s ease,box-shadow .18s ease; }
                .suite-boton-plata:hover { transform:translateY(-1px);filter:brightness(1.04);box-shadow:0 8px 20px rgba(2,8,18,.18); }
                .suite-boton-plata:active { transform:translateY(0) scale(.985); }
                .suite-boton-plata.secundario { background:rgba(255,255,255,.075);border-color:rgba(190,207,226,.19);color:#edf4fb; }
                .suite-input-plata { width:100%;box-sizing:border-box;background:rgba(24,40,62,.72);color:#f7faff;border:1px solid rgba(190,207,226,.22);border-radius:12px;padding:11px 12px;font-size:11px;outline:none;transition:border-color .18s ease,box-shadow .18s ease,background .18s ease; }
                .suite-input-plata:focus { background:rgba(20,35,56,.86);border-color:#48e6bd;box-shadow:0 0 0 3px rgba(72,230,189,.13); }
                .suite-resultado-plata { width:100%;display:flex;align-items:center;gap:10px;text-align:left;background:rgba(255,255,255,.058);color:#edf4fb;border:1px solid rgba(190,207,226,.16);border-radius:13px;padding:11px;margin-bottom:7px;cursor:pointer;box-sizing:border-box;transition:transform .18s ease,background .18s ease,border-color .18s ease; }
                .suite-resultado-plata:hover { transform:translateY(-1px);background:rgba(32,211,163,.08);border-color:rgba(32,211,163,.22); }
                #suite-paleta-comandos { position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.62);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding-top:12vh;font-family:'Inter',-apple-system,sans-serif;box-sizing:border-box; }
                .suite-paleta-caja { width:min(560px,calc(100vw - 28px));max-height:68vh;overflow:hidden;background:linear-gradient(145deg,rgba(48,66,92,.985),rgba(30,47,71,.985));color:#f8fafc;border:1px solid rgba(94,234,212,.38);border-radius:18px;box-shadow:0 30px 76px rgba(15,23,42,.46);padding:12px;box-sizing:border-box; }
                .suite-paleta-lista { max-height:47vh;overflow-y:auto;margin-top:9px; }
                #ventana-kb-plata, #panel-bloc-notas-llamadas, #panel-emergencia-chats-plata {
                    user-select:text !important;
                    -webkit-user-select:text !important;
                }
                [data-suite-drag-handle="true"] {
                    cursor:grab !important;
                    user-select:none !important;
                    -webkit-user-select:none !important;
                }
                [data-suite-drag-handle="true"]:active { cursor:grabbing !important; }
                .suite-scroll-plata, .suite-paleta-lista, #scroll-llamadas,
                #contenedor-scroll-respuestas, #lista-scripts-personalizados,
                #contenedor-lista-chats-scroll {
                    scrollbar-width: thin;
                    scrollbar-color: rgba(94,234,212,.82) rgba(25,41,63,.34);
                    scrollbar-gutter: stable;
                    scroll-behavior:auto !important;
                    overscroll-behavior:contain;
                    touch-action:pan-y;
                    -webkit-overflow-scrolling:touch;
                }
                :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar { width:7px !important;height:7px !important; }
                :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-track { background:rgba(25,41,63,.34) !important;border-radius:999px !important; }
                :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-thumb { background:linear-gradient(180deg,rgba(132,239,211,.82),rgba(32,176,142,.86)) !important;border:2px solid rgba(31,48,72,.48) !important;border-radius:999px !important; }
                :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-thumb:hover { background:linear-gradient(180deg,#71e7c7,#20d3a3) !important; }
                #suite-toast-plata { position:fixed;right:22px;bottom:22px;z-index:2147483647;background:linear-gradient(145deg,#30425c,#1e2f47);color:#f7faff;border:1px solid rgba(94,234,212,.32);border-radius:14px;padding:11px 14px;font:850 10px 'Inter',sans-serif;box-shadow:0 18px 42px rgba(15,23,42,.30);animation:suite-toast-entrada .22s cubic-bezier(.2,.8,.2,1) both; }
                @keyframes suite-toast-entrada { from{opacity:0;transform:translateY(8px) scale(.97)} to{opacity:1;transform:none} }
                body.plata-tema-claro .suite-titulo-plata, body.plata-tema-claro .suite-metrica-valor { color:#172033 !important; }
                body.plata-tema-claro .suite-eyebrow-plata { color:#0f766e !important; }
                body.plata-tema-claro .suite-tab-plata, body.plata-tema-claro .suite-metrica-plata, body.plata-tema-claro .suite-tarjeta-plata, body.plata-tema-claro .suite-resultado-plata { background:rgba(255,255,255,.72) !important;color:#334155 !important;border-color:rgba(14,165,233,.22) !important; }
                body.plata-tema-claro .suite-tab-plata.activo { background:rgba(14,165,233,.14) !important;color:#075985 !important;border-color:rgba(14,165,233,.5) !important; }
                body.plata-tema-claro .suite-input-plata { background:rgba(255,255,255,.9) !important;color:#172033 !important;border-color:rgba(14,165,233,.28) !important; }
                body.plata-tema-claro .suite-chip-plata { background:rgba(255,255,255,.72) !important;color:#475569 !important;border-color:rgba(14,165,233,.2) !important; }
                body.plata-tema-claro :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll) { scrollbar-color:rgba(14,165,233,.78) rgba(203,213,225,.48); }
                body.plata-tema-claro :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-track { background:rgba(203,213,225,.48) !important; }
                body.plata-tema-claro :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-thumb { background:linear-gradient(180deg,#38bdf8,#0284c7) !important;border-color:rgba(241,245,249,.75) !important; }
                body.plata-suite-premium .suite-logo-plata { background:linear-gradient(145deg,var(--sd-acento2),var(--sd-acento)) !important;color:var(--sd-tinta-acento) !important;box-shadow:0 9px 24px color-mix(in srgb,var(--sd-acento) 24%,transparent) !important; }
                body.plata-suite-premium .suite-eyebrow-plata { color:var(--sd-acento2) !important; }
                body.plata-suite-premium .suite-titulo-plata, body.plata-suite-premium .suite-metrica-valor { color:var(--sd-texto) !important; }
                body.plata-suite-premium .suite-chip-plata { background:var(--sd-tarjeta) !important;color:var(--sd-tenue) !important;border-color:var(--sd-borde) !important; }
                body.plata-suite-premium .suite-tab-plata, body.plata-suite-premium .suite-metrica-plata, body.plata-suite-premium .suite-tarjeta-plata, body.plata-suite-premium .suite-resultado-plata, body.plata-suite-premium .tarjeta-chat-premium, body.plata-suite-premium .btn-plantilla-premium { background:var(--sd-tarjeta) !important;color:var(--sd-texto) !important;border-color:var(--sd-borde) !important; }
                body.plata-suite-premium :is(.suite-tab-plata,.suite-metrica-plata,.suite-resultado-plata,.tarjeta-chat-premium,.btn-plantilla-premium):hover { background:var(--sd-tarjeta-hover) !important;border-color:var(--sd-acento) !important; }
                body.plata-suite-premium .suite-tab-plata { color:var(--sd-tenue) !important; }
                body.plata-suite-premium .suite-tab-plata.activo { background:var(--sd-acento-suave) !important;color:var(--sd-acento-contraste) !important;border-color:var(--sd-acento) !important; }
                body.plata-suite-premium .suite-tab-plata.activo::after, body.plata-suite-premium .suite-punto-plata { background:var(--sd-acento) !important; }
                body.plata-suite-premium .suite-metrica-etiqueta, body.plata-suite-premium .suite-metrica-detalle { color:var(--sd-tenue) !important; }
                body.plata-suite-premium .suite-boton-plata { background:linear-gradient(145deg,var(--sd-acento2),var(--sd-acento)) !important;color:var(--sd-tinta-acento) !important;border-color:var(--sd-acento2) !important; }
                body.plata-suite-premium .suite-boton-plata.secundario { background:var(--sd-tarjeta) !important;color:var(--sd-texto) !important;border-color:var(--sd-borde) !important; }
                body.plata-suite-premium .suite-input-plata, body.plata-suite-premium #panel-bloc-notas-llamadas :is(input,textarea,select) { background:var(--sd-campo) !important;color:var(--sd-texto) !important;border-color:var(--sd-borde) !important; }
                body.plata-suite-premium .suite-input-plata:focus, body.plata-suite-premium #panel-bloc-notas-llamadas :is(input,textarea,select):focus { border-color:var(--sd-acento) !important;box-shadow:0 0 0 3px var(--sd-acento-suave) !important; }
                body.plata-suite-premium .suite-paleta-caja, body.plata-suite-premium #suite-toast-plata { background:var(--sd-panel-bg) !important;color:var(--sd-texto) !important;border-color:var(--sd-borde) !important;box-shadow:var(--sd-sombra) !important; }
                body.plata-suite-premium .tarjeta-tema-plata, body.plata-suite-premium #ventana-kb-plata .herramienta-tab-plata, body.plata-suite-premium #ventana-kb-plata .tarjeta-ultimo-chat-plata, body.plata-suite-premium #panel-bloc-notas-llamadas .tarjeta-llamada-plata { background:var(--sd-tarjeta) !important;color:var(--sd-texto) !important;border-color:var(--sd-borde) !important; }
                body.plata-suite-premium .tarjeta-tema-plata.activo { background:var(--sd-acento-suave) !important;border-color:var(--sd-acento) !important; }
                body.plata-suite-premium #ventana-kb-plata .herramienta-tab-plata.activo { background:var(--sd-acento-suave) !important;color:var(--sd-acento-contraste) !important;border-color:var(--sd-acento) !important; }
                body.plata-suite-premium :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll) { scrollbar-color:var(--sd-acento) var(--sd-scroll-track) !important; }
                body.plata-suite-premium :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-track { background:var(--sd-scroll-track) !important; }
                body.plata-suite-premium :is(.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll)::-webkit-scrollbar-thumb { background:linear-gradient(180deg,var(--sd-acento2),var(--sd-acento)) !important;border-color:var(--sd-panel2) !important; }
                .suite-paletas-grid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-bottom:15px; }
                .suite-paleta-opcion { min-width:0;background:var(--sd-tarjeta);color:var(--sd-texto);border:1px solid var(--sd-borde);border-radius:14px;padding:10px;text-align:left;cursor:pointer;transition:transform .18s ease,background .18s ease,border-color .18s ease,box-shadow .18s ease; }
                .suite-paleta-opcion:hover { transform:translateY(-1px);background:var(--sd-tarjeta-hover);border-color:var(--sd-acento); }
                .suite-paleta-opcion.activa { border-color:var(--sd-acento);box-shadow:0 0 0 2px var(--sd-acento-suave); }
                .suite-paleta-muestra { height:25px;border-radius:9px;display:flex;align-items:center;padding:0 8px;gap:5px;margin-bottom:8px;background:linear-gradient(135deg,var(--m1),var(--m2)); }
                .suite-paleta-muestra i { display:block;width:7px;height:7px;border-radius:50%;background:var(--m3);border:1px solid rgba(255,255,255,.58);box-shadow:0 2px 5px rgba(15,23,42,.18); }
                .suite-paleta-opcion b { display:block;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
                .suite-paleta-opcion small { display:block;color:var(--sd-tenue);font-size:7px;line-height:1.35;margin-top:3px; }
                @media (prefers-reduced-motion:reduce) { :is(#reloj-automatico-plata,#panel-cronometros-plata,#ventana-respuestas-plata,#ventana-kb-plata,#panel-bloc-notas-llamadas,#btn-toggle-modo-llamadas,#suite-toast-plata), :is(#reloj-automatico-plata,#panel-cronometros-plata,#ventana-respuestas-plata,#ventana-kb-plata,#panel-bloc-notas-llamadas,#btn-toggle-modo-llamadas,#suite-toast-plata) * { animation-duration:.01ms !important;animation-iteration-count:1 !important;transition-duration:.01ms !important; } }
                @media (max-width:700px) { .suite-nav-plata{grid-template-columns:repeat(2,minmax(0,1fr));}.suite-resumen-grid-plata{grid-template-columns:1fr;} }
            `;
            document.head.appendChild(DOM.estilo);
        },

        crearReloj() {
            if (document.getElementById("reloj-automatico-plata")) return;
            DOM.reloj = document.createElement('div');
            DOM.reloj.id = "reloj-automatico-plata";
            DOM.reloj.style = CONFIG.ESTILO_GLASSMORPHISM;
            this.aplicarDimensionesReloj();
            document.body.appendChild(DOM.reloj);
            this.hacerArrastrable(DOM.reloj, 'pos_reloj_plata_v2', 'reloj');
        },

        aplicarDimensionesReloj() {
            const r = DOM.reloj;
            if (!r) return;
            r.style.setProperty('position', 'fixed', 'important');
            r.style.setProperty('top', STATE.posReloj.top, 'important');
            r.style.setProperty('left', STATE.posReloj.left, 'important');
            r.style.setProperty('width', STATE.posReloj.width, 'important');
            r.style.setProperty('height', STATE.posReloj.height, 'important');
            r.style.setProperty('min-width', '110px', 'important');
            r.style.setProperty('min-height', '40px', 'important');
            r.style.setProperty('resize', 'both', 'important');
            r.style.setProperty('overflow', 'hidden', 'important');
        },

        crearPanelControl() {
            if (document.getElementById("panel-cronometros-plata")) return;
            DOM.panel = document.createElement('div');
            DOM.panel.id = "panel-cronometros-plata";
            DOM.panel.style = CONFIG.ESTILO_GLASSMORPHISM;
            this.aplicarDimensionesPanel();
            document.body.appendChild(DOM.panel);
            this.hacerArrastrable(DOM.panel, 'pos_panel_plata_v2', 'panel');
            this.aplicarVisibilidadPanelCronometros();
        },

        aplicarVisibilidadPanelCronometros() {
            if (!DOM.panel) return;
            const debeMostrar = STATE.panelCronometrosVisible && !STATE.modoLlamadasActivo;
            DOM.panel.style.setProperty('display', debeMostrar ? 'block' : 'none', 'important');
            if (debeMostrar) requestAnimationFrame(() => this.recuperarVentanasFueraDeVista());
        },

        alternarPanelCronometros() {
            STATE.panelCronometrosVisible = !STATE.panelCronometrosVisible;
            localStorage.setItem('panel_cronometros_visible_plata_v1', String(STATE.panelCronometrosVisible));
            if (STATE.panelCronometrosVisible) {
                STATE._lastKeysStr = 'FORCE_INITIAL_RENDER';
                COLA_VISUAL.solicitar('panel');
            }
            this.aplicarVisibilidadPanelCronometros();
            if (STATE.posKB.vista === 'tema' && !STATE.posKB.minimizado) this.renderizarSelectorTema();
            this.mostrarToast(`Panel flotante ${STATE.panelCronometrosVisible ? 'habilitado' : 'deshabilitado'}`);
        },

        restablecerPosicionesPaneles() {
            const ancho = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1280);
            const limitarIzquierda = (preferida, anchoPanel) => `${Math.max(10, Math.min(preferida, ancho - anchoPanel - 10))}px`;
            const vistaKB = STATE.posKB?.vista || 'tema';
            const kbMinimizada = Boolean(STATE.posKB?.minimizado);

            STATE.posReloj = { top:'25px', left:limitarIzquierda(340, 300), width:'300px', height:'80px' };
            STATE.posPanel = { bottom:'25px', left:'25px', top:'auto', width:'300px', height:'360px' };
            STATE.posRespuestas = { top:'160px', left:limitarIzquierda(340, 300), width:'300px', height:'280px', minimizado:false };
            STATE.posBlocNotas = { top:'100px', left:limitarIzquierda(350, 420), width:'420px', height:'520px', minimizado:false };
            STATE.posBotonModo = { top:'12px', right:'20px', left:'auto' };
            STATE.posKB = { top:'12%', left:'auto', right:'18px', width:'480px', height:'560px', minimizado:kbMinimizada, vista:vistaKB };

            localStorage.setItem('pos_reloj_plata_v2', JSON.stringify(STATE.posReloj));
            localStorage.setItem('pos_panel_plata_v2', JSON.stringify(STATE.posPanel));
            localStorage.setItem('pos_respuestas_plata_v2', JSON.stringify(STATE.posRespuestas));
            localStorage.setItem('pos_bloc_notas_plata_v1', JSON.stringify(STATE.posBlocNotas));
            localStorage.setItem('pos_btn_modo_plata_v1', JSON.stringify(STATE.posBotonModo));
            localStorage.setItem('pos_herramientas_plata_v1', JSON.stringify(STATE.posKB));

            this.aplicarDimensionesReloj();
            this.aplicarDimensionesPanel();
            this.aplicarDimensionesRespuestas();
            this.aplicarDimensionesBlocNotas();
            this.aplicarDimensionesBotonModo();
            this.renderizarKB();
            this.inicializarEstructuraFijaRespuestas();
            this.actualizarVisibilidadPorModo();
            this.mostrarToast('Paneles devueltos a posiciones seguras');
        },

        recuperarVentanasFueraDeVista() {
            const anchoVista = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 1280);
            const altoVista = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 720);
            const margen = 10;
            if (STATE.posKB.minimizado) this.posicionarAccesoSuperior(DOM.kb);

            const paneles = [
                { elemento:DOM.reloj, estado:STATE.posReloj, clave:'pos_reloj_plata_v2', tipo:'reloj' },
                { elemento:DOM.panel, estado:STATE.posPanel, clave:'pos_panel_plata_v2', tipo:'panel' },
                { elemento:DOM.ventana, estado:STATE.posRespuestas, clave:'pos_respuestas_plata_v2', tipo:'respuestas' },
                { elemento:DOM.blocNotas, estado:STATE.posBlocNotas, clave:'pos_bloc_notas_plata_v1', tipo:'blocNotas' },
                { elemento:DOM.btnModoLlamadas, estado:STATE.posBotonModo, clave:'pos_btn_modo_plata_v1', tipo:'botonModo' },
                { elemento:DOM.kb, estado:STATE.posKB, clave:'pos_herramientas_plata_v1', tipo:'centro' }
            ];

            let recuperadas = 0;
            paneles.forEach(({ elemento, estado, clave, tipo }) => {
                if (!elemento || !estado || (tipo === 'centro' && STATE.posKB.minimizado)) return;
                const estilo = getComputedStyle(elemento);
                if (estilo.display === 'none' || estilo.visibility === 'hidden') return;
                const rect = elemento.getBoundingClientRect();
                if (rect.width < 20 || rect.height < 20) return;
                const visibleX = Math.max(0, Math.min(rect.right, anchoVista) - Math.max(rect.left, 0));
                const visibleY = Math.max(0, Math.min(rect.bottom, altoVista) - Math.max(rect.top, 0));
                const fuera = visibleX < Math.min(56, rect.width * .35) || visibleY < Math.min(44, rect.height * .3);
                if (!fuera) return;

                const izquierda = Math.max(margen, Math.min(rect.left, anchoVista - rect.width - margen));
                const arriba = Math.max(margen, Math.min(rect.top, altoVista - rect.height - margen));
                elemento.style.setProperty('left', `${Math.round(izquierda)}px`, 'important');
                elemento.style.setProperty('top', `${Math.round(arriba)}px`, 'important');
                elemento.style.setProperty('right', 'auto', 'important');
                if (tipo === 'panel') elemento.style.setProperty('bottom', 'auto', 'important');
                estado.left = `${Math.round(izquierda)}px`;
                estado.top = `${Math.round(arriba)}px`;
                estado.right = 'auto';
                if (tipo === 'panel') estado.bottom = 'auto';
                localStorage.setItem(clave, JSON.stringify(estado));
                recuperadas += 1;
            });
            if (recuperadas) {
                RENDIMIENTO.recuperacionesVentanas += recuperadas;
                RENDIMIENTO.actualizarVista();
            }
            return recuperadas;
        },

        aplicarDimensionesPanel() {
            const p = DOM.panel;
            if (!p) return;
            p.style.setProperty('position', 'fixed', 'important');
            p.style.setProperty('top', STATE.posPanel.top, 'important');
            p.style.setProperty('bottom', STATE.posPanel.bottom, 'important');
            p.style.setProperty('left', STATE.posPanel.left, 'important');
            p.style.setProperty('width', STATE.posPanel.width, 'important');
            p.style.setProperty('height', STATE.posPanel.height, 'important');
            p.style.setProperty('padding', '14px', 'important');
            p.style.setProperty('min-width', '180px', 'important');
            p.style.setProperty('min-height', '100px', 'important');
            p.style.setProperty('resize', 'both', 'important');
            p.style.setProperty('overflow', 'hidden', 'important');
        },

        crearPanelRespuestas() {
            if (document.getElementById("ventana-respuestas-plata")) return;
            DOM.ventana = document.createElement('div');
            DOM.ventana.id = "ventana-respuestas-plata";
            document.body.appendChild(DOM.ventana);
            this.aplicarDimensionesRespuestas();
            this.hacerArrastrable(DOM.ventana, 'pos_respuestas_plata_v2', 'respuestas');
            this.inicializarEstructuraFijaRespuestas();
        },

        crearPanelKB() {
            if (document.getElementById('ventana-kb-plata')) return;
            const k = DOM.kb = document.createElement('div');
            k.id = 'ventana-kb-plata';
            document.body.appendChild(k);
            this.hacerArrastrable(k, 'pos_herramientas_plata_v1', 'kb');
            this.renderizarKB();
        },
        posicionarAccesoSuperior(elemento = DOM.kb) {
            if (!elemento || !STATE.posKB.minimizado) return;
            const ancho = 196;
            const margen = 10;
            // Es fijo: no depende de la posición guardada ni de si hay chats activos.
            // Ajuste visual: el cuadro completo queda 40 px más a la derecha.
            const izquierdaFija = 320;
            const left = Math.max(margen, Math.min(izquierdaFija, window.innerWidth - ancho - margen));
            elemento.style.setProperty('top', '0', 'important');
            elemento.style.setProperty('left', `${Math.round(left)}px`, 'important');
            elemento.style.setProperty('right', 'auto', 'important');
            elemento.style.setProperty('transform', 'none', 'important');
        },
        cabeceraHerramientas() {
            const boton = (vista, icono, texto) => {
                const activo = STATE.posKB.vista === vista;
                return `<button class="suite-tab-plata ${activo ? 'activo' : ''}" data-action="herramientas-vista" data-vista="${vista}" title="${texto}"><span style="display:block;font-size:13px;margin-bottom:3px;">${icono}</span>${texto}</button>`;
            };
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid rgba(148,163,184,.14);">
                <div class="suite-marca-plata"><span data-suite-drag-handle="true" title="Arrastrar ventana" aria-label="Arrastrar ventana" style="width:18px;height:30px;display:grid;place-items:center;color:#64748b;font-size:14px;flex:0 0 auto;">⠿</span><span class="suite-logo-plata">SD</span><span style="min-width:0"><span class="suite-eyebrow-plata">Centro de control</span><span class="suite-titulo-plata">${SUITE_NOMBRE}</span></span></div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <button id="suite-version-chip" data-action="actualizar-suite" title="Comprobar actualizaciones" class="suite-chip-plata" style="cursor:pointer;font:inherit;">v${SUITE_VERSION}</button>
                    <button data-action="suite-abrir-paleta" title="Acciones rápidas · Ctrl + K" class="suite-boton-plata secundario" style="padding:6px 8px;">⌘ K</button>
                    <button data-action="kb-minimizar" title="Cerrar al borde superior" class="suite-boton-plata secundario" style="padding:6px 9px;">—</button>
                </div>
            </div><div class="suite-nav-plata">${boton('inicio','⌂','Inicio')}${boton('ultimos','◷','Historial')}${boton('tema','⚙','Ajustes')}${boton('acerca','ⓘ','Acerca')}</div>`;
        },
        renderizarKB() {
            const k=DOM.kb; if(!k)return; k.style=CONFIG.ESTILO_GLASSMORPHISM;
            this.aplicarTemaEnElemento(k);
            if(STATE.posKB.minimizado){
                const claro = STATE.tema === 'claro';
                k.style.cssText+=`;width:196px;height:46px;padding:4px;resize:none;overflow:hidden;border-radius:0 0 15px 15px;border-top:0!important;box-shadow:0 12px 28px rgba(0,0,0,.34);`;
                k.innerHTML=`<button data-action="kb-restaurar" title="Abrir Centro de Control" style="width:100%;height:100%;display:flex;align-items:center;gap:9px;background:var(--sd-panel-bg);color:var(--sd-texto);border:0;border-radius:0 0 11px 11px;padding:4px 10px;cursor:pointer;text-align:left;"><span class="suite-logo-plata" style="width:29px;height:29px;border-radius:9px;">SD</span><span style="display:flex;flex-direction:column;line-height:1.05;min-width:0;"><b style="font-size:10px;letter-spacing:.04em;">Sistema Dual</b><small id="suite-version-minimizada" style="font-size:8px;color:var(--sd-tenue);margin-top:4px;">Centro de control · v${ACTUALIZADOR_SUITE.disponible ? `${ACTUALIZADOR_SUITE.versionRemota} disponible` : SUITE_VERSION}</small></span><span style="margin-left:auto;color:var(--sd-acento);font-size:13px;font-weight:900;">⌄</span></button>`;
                this.posicionarAccesoSuperior(k);
                return;
            }
            const top = STATE.posKB.top === '50%' ? '12%' : STATE.posKB.top;
            const left = STATE.posKB.left && STATE.posKB.left !== 'auto' ? `left:${STATE.posKB.left};right:auto;` : `left:auto;right:${STATE.posKB.right || '18px'};`;
            k.style.cssText+=`;top:${top};${left}transform:none;width:${STATE.posKB.width || '480px'};height:${STATE.posKB.height || '560px'};padding:14px;resize:both;overflow:hidden;min-width:390px;min-height:390px;max-width:calc(100vw - 20px);max-height:88vh;`;
            if (STATE.posKB.vista === 'inicio') {
                this.renderizarInicioHerramientas();
                return;
            }
            if (STATE.posKB.vista === 'ultimos') {
                this.renderizarUltimosHerramientas();
                return;
            }
            if (STATE.posKB.vista === 'tema') {
                this.renderizarSelectorTema();
                return;
            }
            if (STATE.posKB.vista === 'acerca') {
                this.renderizarAcercaHerramientas();
                return;
            }
            STATE.posKB.vista = 'inicio';
            this.renderizarInicioHerramientas();
        },
        obtenerResumenOperativo() {
            const turno = STATE.turnoActual;
            const chatsTurno = Number(turno?.totalInteracciones) || 0;
            const ahtTurno = turno?.finalizadas ? Math.round((Number(turno.totalSegundos) || 0) / turno.finalizadas) : 0;
            const pendientes = (STATE.registroLlamadas || []).filter(item => item.estado === 'SIN_JUSTIFICAR').length;
            return { chatsTurno, ahtTurno, pendientes, scripts: STATE.obtenerTodasLasPlantillas().length, turnoActivo: Boolean(turno) };
        },
        renderizarInicioHerramientas() {
            const k = DOM.kb; if (!k || STATE.posKB.minimizado) return;
            const resumen = this.obtenerResumenOperativo();
            const almacenamientoOK = (() => { try { localStorage.setItem('__suite_test__','1'); localStorage.removeItem('__suite_test__'); return true; } catch { return false; } })();
            const redOK = navigator.onLine !== false;
            const nombre = UTILS.escaparHTML(STATE.nombreAgente || 'Agente');
            const correo = UTILS.escaparHTML(AUTH_MANAGER.usuario?.email || 'Cuenta no disponible');
            const inicialCuenta = UTILS.escaparHTML((AUTH_MANAGER.usuario?.displayName || AUTH_MANAGER.usuario?.email || 'A').trim().charAt(0).toUpperCase());
            k.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;">${this.cabeceraHerramientas()}
                <div class="suite-scroll-plata" style="overflow-y:auto;min-height:0;flex:1;padding-right:3px;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-end;gap:12px;margin:2px 0 11px;">
                        <div><div style="font-size:15px;font-weight:950;">Hola, ${nombre}</div><div style="font-size:9px;color:#94a3b8;margin-top:4px;">Tu turno actual, aunque cruce medianoche.</div></div>
                        <span id="suite-inicio-estado" class="suite-chip-plata"><span class="suite-punto-plata ${redOK ? '' : 'aviso'}"></span>${redOK ? 'Sistema activo' : 'Sin conexión'}</span>
                    </div>
                    ${NUBE_COMPARTIDA.renderizarNoticiaInicio()}
                    <div class="suite-resumen-grid-plata">
                        <div class="suite-metrica-plata" style="--suite-acento:rgba(45,212,191,.17)"><div class="suite-metrica-etiqueta">Chats del día</div><div id="suite-inicio-chats" class="suite-metrica-valor">${resumen.chatsTurno}</div><div class="suite-metrica-detalle">Turno actual · sin duplicados</div></div>
                        <div class="suite-metrica-plata" style="--suite-acento:rgba(14,165,233,.17)"><div class="suite-metrica-etiqueta">AHT del turno</div><div id="suite-inicio-aht" class="suite-metrica-valor" style="font-size:18px;">${UTILS.formatearTiempo(resumen.ahtTurno)}</div><div class="suite-metrica-detalle">Solo interacciones finalizadas</div></div>
                        <button data-action="ver-llamadas-pendientes" class="suite-metrica-plata" style="--suite-acento:rgba(245,158,11,.16);text-align:left;color:inherit;cursor:pointer"><div class="suite-metrica-etiqueta">Llamadas pendientes</div><div id="suite-inicio-pendientes" class="suite-metrica-valor">${resumen.pendientes}</div><div class="suite-metrica-detalle">Ver las que requieren justificar</div></button>
                        <div class="suite-metrica-plata" style="--suite-acento:rgba(139,92,246,.17)"><div class="suite-metrica-etiqueta">Scripts</div><div id="suite-inicio-scripts" class="suite-metrica-valor">${resumen.scripts}</div><div class="suite-metrica-detalle">Disponibles para el agente</div></div>
                    </div>
                    <div style="display:flex;gap:7px;margin:10px 0;flex-wrap:wrap;"><button class="suite-boton-plata" data-action="abrir-editor-scripts">✎ Mis Scripts</button><button class="suite-boton-plata secundario" data-action="finalizar-turno">✓ Finalizar turno</button><button class="suite-boton-plata secundario" data-action="suite-abrir-paleta">⌘ Acciones rápidas</button></div>
                    <div class="suite-tarjeta-plata" style="margin-bottom:9px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:9px;"><b style="font-size:10px;">Estado del sistema</b><span style="font-size:8px;color:#94a3b8;">Actualización automática</span></div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:9px;"><span class="suite-chip-plata"><span class="suite-punto-plata"></span>Detector de chats</span><span class="suite-chip-plata"><span class="suite-punto-plata ${almacenamientoOK ? '' : 'aviso'}"></span>Guardado ${almacenamientoOK ? 'activo' : 'limitado'}</span><span class="suite-chip-plata"><span class="suite-punto-plata"></span>Respuestas rápidas</span><span class="suite-chip-plata"><span class="suite-punto-plata ${redOK ? '' : 'aviso'}"></span>Red ${redOK ? 'disponible' : 'desconectada'}</span></div>
                    </div>
                    <div class="suite-tarjeta-plata" style="display:flex;align-items:center;gap:10px;margin-bottom:9px;"><span style="width:36px;height:36px;display:grid;place-items:center;border-radius:12px;background:linear-gradient(145deg,#0ea5e9,#0f766e);font-size:13px;font-weight:950;color:white;flex:0 0 auto;">${inicialCuenta}</span><span style="min-width:0;flex:1;"><b style="display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">Cuenta empresarial vinculada</b><small style="display:block;color:#94a3b8;font-size:8px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${correo}</small></span><span class="suite-chip-plata"><span class="suite-punto-plata ${AUTH_MANAGER.perfilSincronizado ? '' : 'aviso'}"></span>${AUTH_MANAGER.perfilSincronizado ? 'Sincronizada' : 'Pendiente'}</span><button data-action="suite-cerrar-sesion" class="suite-boton-plata secundario" style="padding:7px 8px;">Salir</button></div>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(148,163,184,.12);padding-top:9px;margin-top:8px;color:#94a3b8;font-size:8px;"><span>Diseño y desarrollo: <b style="color:#5eead4;">${SUITE_AUTOR}</b></span><span>Ctrl + K: acciones rápidas</span></div>
            </div>`;
            this.aplicarTemaEnElemento(k);
        },
        actualizarResumenInicio() {
            if (STATE.posKB.vista !== 'inicio' || STATE.posKB.minimizado || !DOM.kb) return;
            const resumen = this.obtenerResumenOperativo();
            const asignar = (id, valor) => {
                const elemento = document.getElementById(id);
                if (elemento && elemento.textContent !== String(valor)) elemento.textContent = String(valor);
            };
            asignar('suite-inicio-chats', resumen.chatsTurno);
            asignar('suite-inicio-aht', UTILS.formatearTiempo(resumen.ahtTurno));
            asignar('suite-inicio-pendientes', resumen.pendientes);
            asignar('suite-inicio-scripts', resumen.scripts);
            const estado = document.getElementById('suite-inicio-estado');
            if (estado) {
                const redOK = navigator.onLine !== false;
                const html = `<span class="suite-punto-plata ${redOK ? '' : 'aviso'}"></span>${redOK ? 'Sistema activo' : 'Sin conexión'}`;
                if (estado.innerHTML !== html) estado.innerHTML = html;
            }
        },
        obtenerResultadosBusqueda(consulta) {
            const q = UTILS.pointerNormalizer(String(consulta || '')).toLowerCase();
            const resultados = [];
            const coincide = (...textos) => !q || textos.some(texto => UTILS.pointerNormalizer(String(texto || '')).toLowerCase().includes(q));
            const acciones = [
                { titulo:'Abrir Centro de Control', detalle:'Resumen operativo', icono:'⌂', accion:'inicio' },
                { titulo:'Abrir Mis Scripts', detalle:'Administrar, importar o exportar', icono:'✎', accion:'scripts' },
                { titulo:'Ver últimos tres clientes', detalle:'Respaldo de emergencia e IDs', icono:'🛟', accion:'ultimos' },
                { titulo:'Abrir ajustes', detalle:'Panel flotante y apariencia', icono:'⚙', accion:'tema' },
                { titulo:'Ver información de la suite', detalle:`Versión ${SUITE_VERSION} y última actualización`, icono:'ⓘ', accion:'acerca' }
            ];
            acciones.forEach(item => { if (coincide(item.titulo,item.detalle)) resultados.push({ tipo:'Acción', ...item }); });
            STATE.obtenerTodasLasPlantillas().forEach((script, indice) => {
                if (coincide(script.titulo, script.comando, script.texto)) resultados.push({ tipo:'Script', titulo:script.titulo || `Script ${indice + 1}`, detalle:`${script.comando || 'Sin comando'} · Copiar respuesta`, icono:'⚡', accion:'copiar-script', valor:script.texto || '' });
            });
            (STATE.historialEmergencia || []).forEach(item => {
                if (coincide(item.nombreCliente,item.uidCliente,item.taskId)) resultados.push({ tipo:'Cliente', titulo:item.nombreCliente || 'Cliente', detalle:item.uidCliente ? `ID: ${item.uidCliente}` : 'ID pendiente', icono:'●', accion:item.uidCliente ? 'copiar-texto' : 'ultimos', valor:item.uidCliente || '' });
            });
            (STATE.registroLlamadas || []).slice(0,30).forEach(item => {
                if (coincide(item.cliente,item.idLlamada,item.notas,item.estado)) resultados.push({ tipo:'Llamada', titulo:item.cliente || 'Llamada sin nombre', detalle:`${item.estado || 'Sin estado'} · Abrir módulo`, icono:'☎', accion:'llamadas' });
            });
            return resultados.slice(0,40);
        },
        renderizarAcercaHerramientas() {
            const k = DOM.kb; if (!k || STATE.posKB.minimizado) return;
            k.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;">${this.cabeceraHerramientas()}<div class="suite-scroll-plata" style="overflow-y:auto;min-height:0;flex:1;padding-right:3px;">
                <div class="suite-tarjeta-plata" style="text-align:center;padding:18px;margin-bottom:10px;"><span class="suite-logo-plata" style="width:54px;height:54px;border-radius:17px;margin:0 auto 11px;font-size:16px;">SD</span><div style="font-size:17px;font-weight:950;">${SUITE_NOMBRE}</div><div style="font-size:9px;color:#94a3b8;margin-top:5px;">Suite operativa para atención al cliente</div><div style="display:flex;justify-content:center;gap:6px;margin-top:11px;"><span class="suite-chip-plata">Versión ${SUITE_VERSION}</span><span class="suite-chip-plata"><span class="suite-punto-plata"></span>Optimizada</span></div></div>
                <div class="suite-tarjeta-plata" style="margin-bottom:10px;"><div class="suite-eyebrow-plata">Autoría</div><div style="font-size:13px;font-weight:900;margin-top:7px;">Diseño y desarrollo</div><div style="font-size:11px;color:#5eead4;font-weight:850;margin-top:5px;">${SUITE_AUTOR}</div><div style="font-size:8px;color:#94a3b8;line-height:1.55;margin-top:7px;">Identidad, arquitectura operativa, cronómetros, AHT, respuestas, llamadas, respaldos y experiencia integral de la suite.</div></div>
            </div></div>`;
            this.aplicarTemaEnElemento(k);
        },
        mostrarToast(mensaje) {
            document.getElementById('suite-toast-plata')?.remove();
            const toast = document.createElement('div');
            toast.id = 'suite-toast-plata';
            toast.textContent = String(mensaje || 'Listo');
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2600);
        },
        abrirPaletaComandos(consulta = '') {
            document.getElementById('suite-paleta-comandos')?.remove();
            const modal = document.createElement('div');
            modal.id = 'suite-paleta-comandos';
            document.body.appendChild(modal);
            this.renderizarPaletaComandos(consulta, true);
        },
        cerrarPaletaComandos() {
            document.getElementById('suite-paleta-comandos')?.remove();
        },
        renderizarPaletaComandos(consulta = '', enfocar = false) {
            const modal = document.getElementById('suite-paleta-comandos');
            if (!modal) return;
            const resultados = this.obtenerResultadosBusqueda(consulta).slice(0, 14);
            STATE.resultadosPaletaSuite = resultados;
            const filas = resultados.length ? resultados.map((item, indice) => `<button class="suite-resultado-plata" data-action="suite-resultado-paleta" data-indice="${indice}"><span style="width:32px;height:32px;display:grid;place-items:center;border-radius:10px;background:rgba(16,185,129,.14);color:#5eead4;font-size:14px;flex:0 0 auto;">${item.icono}</span><span style="min-width:0;flex:1;"><b style="display:block;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${UTILS.escaparHTML(item.titulo)}</b><small style="display:block;color:#94a3b8;font-size:8px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${UTILS.escaparHTML(item.detalle)}</small></span><span class="suite-chip-plata">${item.tipo}</span></button>`).join('') : `<div style="padding:28px;text-align:center;color:#94a3b8;font-size:10px;">No encontré coincidencias.</div>`;
            modal.innerHTML = `<div class="suite-paleta-caja" role="dialog" aria-label="Paleta de comandos"><div style="display:flex;align-items:center;gap:9px;"><span class="suite-logo-plata">SD</span><input id="suite-paleta-input" class="suite-input-plata" value="${UTILS.escaparHTML(consulta)}" placeholder="¿Qué necesitas hacer?" autocomplete="off"><button data-action="suite-cerrar-paleta" class="suite-boton-plata secundario" style="padding:9px;">Esc</button></div><div style="display:flex;justify-content:space-between;color:#94a3b8;font-size:8px;padding:9px 3px 0;"><span>${resultados.length} opciones</span><span>Busca funciones, scripts, clientes o llamadas</span></div><div class="suite-paleta-lista">${filas}</div></div>`;
            if (enfocar) { const input=modal.querySelector('#suite-paleta-input'); input?.focus(); input?.setSelectionRange(input.value.length,input.value.length); }
        },
        async ejecutarResultadoSuite(item) {
            if (!item) return;
            const abrirVista = vista => {
                STATE.posKB.vista = vista;
                STATE.posKB.minimizado = false;
                localStorage.setItem('pos_herramientas_plata_v1', JSON.stringify(STATE.posKB));
                this.renderizarKB();
            };
            if (['inicio','ultimos','tema','acerca'].includes(item.accion)) abrirVista(item.accion);
            else if (item.accion === 'scripts') this.abrirModalEditorScripts();
            else if (item.accion === 'vista-operativa') this.alternarVistaOperativa();
            else if (item.accion === 'llamadas') {
                if (!STATE.modoLlamadasActivo) this.establecerModoLlamadas(true, false);
                else this.renderizarContenidoBlocNotas();
            }
            else if (item.accion === 'copiar-script' || item.accion === 'copiar-texto') {
                const copiado = await this.copiarTextoEmergencia(item.valor || '');
                this.mostrarToast(copiado ? 'Texto copiado' : 'No fue posible copiar');
            }
            this.cerrarPaletaComandos();
        },
        normalizarEstadoHistorial(item) {
            const estado = item?.estadoGestion || item?.estadoLlamada || 'SIN_NOVEDAD';
            return ['SIN_NOVEDAD', 'SIN_JUSTIFICAR', 'JUSTIFICADO'].includes(estado) ? estado : 'SIN_NOVEDAD';
        },

        fechaLocalHistorial(valor) {
            const fecha = new Date(valor || 0);
            if (Number.isNaN(fecha.getTime())) return '';
            const dos = numero => String(numero).padStart(2, '0');
            return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
        },

        obtenerHistorialFiltrado() {
            const busqueda = UTILS.pointerNormalizer(STATE.historialBusqueda || '').toLowerCase();
            return (STATE.historial7Dias || []).filter(item => {
                const tipo = String(item.tipo || 'PENDIENTE').toUpperCase();
                const estado = this.normalizarEstadoHistorial(item);
                const texto = UTILS.pointerNormalizer([
                    item.cliente, item.idCliente, item.interaccionId, item.notas,
                    item.resultado, tipo, estado
                ].filter(Boolean).join(' ')).toLowerCase();
                return (!busqueda || texto.includes(busqueda))
                    && (!STATE.historialFiltroFecha || this.fechaLocalHistorial(item.inicioISO) === STATE.historialFiltroFecha)
                    && (STATE.historialFiltroTipo === 'TODOS' || tipo === STATE.historialFiltroTipo)
                    && (STATE.historialFiltroEstado === 'TODOS' || estado === STATE.historialFiltroEstado);
            });
        },

        formatearFechaHistorial(valor) {
            const fecha = new Date(valor || 0);
            return Number.isNaN(fecha.getTime()) ? 'No disponible' : fecha.toLocaleString('es-MX', {
                day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'
            });
        },

        construirTarjetasHistorial() {
            const lista = this.obtenerHistorialFiltrado();
            if (!lista.length) return `<div style="padding:28px 12px;text-align:center;color:#94a3b8;font-size:10px;">No hay interacciones que coincidan con los filtros.</div>`;
            const ahora = Date.now();
            const opcion = (valor, actual, texto) => `<option value="${valor}" ${actual === valor ? 'selected' : ''}>${texto}</option>`;

            return lista.slice(0, 300).map(item => {
                const tipo = String(item.tipo || 'PENDIENTE').toUpperCase();
                const estado = this.normalizarEstadoHistorial(item);
                const resultado = ['RESUELTO', 'NO_RESUELTO'].includes(item.resultado) ? item.resultado : 'SIN_DEFINIR';
                const inicioMs = new Date(item.inicioISO || 0).getTime();
                const finMs = item.finISO ? new Date(item.finISO).getTime() : 0;
                const duracion = Number(item.duracionSeg) || (Number.isFinite(inicioMs) ? Math.max(0, Math.round(((Number.isFinite(finMs) && finMs > 0) ? finMs : ahora) - inicioMs) / 1000) : 0);
                const id = UTILS.escaparHTML(item.interaccionId || '');
                const colorEstado = estado === 'JUSTIFICADO' ? '#34d399' : estado === 'SIN_JUSTIFICAR' ? '#fca5a5' : '#fbbf24';

                return `<article class="suite-tarjeta-plata suite-registro-historial" data-interaccion-id="${id}" style="margin:0 0 9px;padding:10px;border-color:${estado === 'SIN_JUSTIFICAR' ? 'rgba(239,68,68,.38)' : estado === 'JUSTIFICADO' ? 'rgba(16,185,129,.32)' : 'rgba(148,163,184,.16)'};user-select:text;">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <b style="font-size:11px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${UTILS.escaparHTML(item.cliente || 'Cliente')}</b>
                        <span class="suite-chip-plata">${UTILS.escaparHTML(tipo)}</span>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;margin-top:7px;font-size:8px;color:#94a3b8;line-height:1.45;">
                        <span>Ingresó<br><b style="color:#e2e8f0;">${UTILS.escaparHTML(this.formatearFechaHistorial(item.inicioISO))}</b></span>
                        <span>Finalizó<br><b style="color:${item.finISO ? '#e2e8f0' : '#34d399'};">${item.finISO ? UTILS.escaparHTML(this.formatearFechaHistorial(item.finISO)) : 'En curso'}</b></span>
                    </div>
                    <div style="font-size:8px;color:#94a3b8;margin-top:6px;">Duración: <b data-historial-duracion data-inicio-ms="${Number.isFinite(inicioMs) ? inicioMs : 0}" data-fin-ms="${Number.isFinite(finMs) ? finMs : 0}" style="color:#38bdf8;">${UTILS.formatearTiempo(duracion)}</b></div>
                    <div style="font-size:8px;color:#94a3b8;margin-top:5px;word-break:break-all;">ID: <b style="color:#c4b5fd;">${UTILS.escaparHTML(item.idCliente || item.interaccionId || 'No disponible')}</b></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px;">
                        <label style="font-size:8px;color:#94a3b8;">Resultado
                            <select class="suite-input-plata" data-action="historial-cambiar-resultado" data-id="${id}" style="padding:7px 8px;margin-top:4px;font-size:9px;">${opcion('SIN_DEFINIR', resultado, 'Sin definir')}${opcion('RESUELTO', resultado, 'Resuelto')}${opcion('NO_RESUELTO', resultado, 'No resuelto')}</select>
                        </label>
                        <label style="font-size:8px;color:#94a3b8;">Seguimiento
                            <select class="suite-input-plata" data-action="historial-cambiar-estado" data-id="${id}" style="padding:7px 8px;margin-top:4px;font-size:9px;color:${colorEstado};">${opcion('SIN_NOVEDAD', estado, 'Sin novedad')}${opcion('SIN_JUSTIFICAR', estado, 'Sin justificar')}${opcion('JUSTIFICADO', estado, 'Justificado')}</select>
                        </label>
                    </div>
                    <label style="display:block;font-size:8px;color:#94a3b8;margin-top:7px;">Nota
                        <textarea class="suite-input-plata" data-action="historial-actualizar-notas" data-id="${id}" placeholder="Agrega una nota opcional..." style="height:48px;min-height:42px;margin-top:4px;padding:8px;resize:vertical;user-select:text;">${UTILS.escaparHTML(item.notas || '')}</textarea>
                    </label>
                </article>`;
            }).join('');
        },

        actualizarListaHistorial(conservarScroll = true) {
            const contenedor = document.getElementById('suite-historial-lista');
            if (!contenedor) return;
            const scrollAnterior = conservarScroll ? contenedor.scrollTop : 0;
            contenedor.innerHTML = this.construirTarjetasHistorial();
            contenedor.scrollTop = Math.min(scrollAnterior, Math.max(0, contenedor.scrollHeight - contenedor.clientHeight));
            const contador = document.getElementById('suite-historial-contador');
            if (contador) contador.textContent = `${this.obtenerHistorialFiltrado().length} de ${STATE.historial7Dias.length}`;
        },

        actualizarDuracionesHistorialVisible() {
            document.querySelectorAll('#suite-historial-lista [data-historial-duracion]').forEach(elemento => {
                const inicio = Number(elemento.getAttribute('data-inicio-ms')) || 0;
                const fin = Number(elemento.getAttribute('data-fin-ms')) || 0;
                if (!inicio) return;
                elemento.textContent = UTILS.formatearTiempo(Math.max(0, Math.round(((fin > 0 ? fin : Date.now()) - inicio) / 1000)));
            });
        },

        renderizarUltimosHerramientas() {
            const k = DOM.kb; if (!k || STATE.posKB.minimizado) return;
            const scrollAnterior = k.querySelector('#suite-historial-lista')?.scrollTop || 0;
            const filtrados = this.obtenerHistorialFiltrado();
            k.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box;">${this.cabeceraHerramientas()}
                <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">
                    <div><b style="font-size:11px;color:#5eead4;">Historial de interacciones</b><small style="display:block;font-size:8px;color:#94a3b8;margin-top:3px;">Chats y llamadas guardados localmente durante 7 días</small></div>
                    <span id="suite-historial-contador" class="suite-chip-plata">${filtrados.length} de ${STATE.historial7Dias.length}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px;">
                    <input id="suite-historial-busqueda" class="suite-input-plata" value="${UTILS.escaparHTML(STATE.historialBusqueda)}" placeholder="Buscar cliente, ID o nota..." style="grid-column:1/-1;padding:9px 10px;font-size:10px;">
                    <input id="suite-historial-fecha" type="date" class="suite-input-plata" value="${UTILS.escaparHTML(STATE.historialFiltroFecha)}" style="padding:8px;font-size:9px;">
                    <select id="suite-historial-tipo" class="suite-input-plata" style="padding:8px;font-size:9px;"><option value="TODOS" ${STATE.historialFiltroTipo === 'TODOS' ? 'selected' : ''}>Chat y llamada</option><option value="CHAT" ${STATE.historialFiltroTipo === 'CHAT' ? 'selected' : ''}>Solo chat</option><option value="LLAMADA" ${STATE.historialFiltroTipo === 'LLAMADA' ? 'selected' : ''}>Solo llamada</option></select>
                    <select id="suite-historial-estado" class="suite-input-plata" style="grid-column:1/-1;padding:8px;font-size:9px;"><option value="TODOS" ${STATE.historialFiltroEstado === 'TODOS' ? 'selected' : ''}>Todos los seguimientos</option><option value="SIN_NOVEDAD" ${STATE.historialFiltroEstado === 'SIN_NOVEDAD' ? 'selected' : ''}>Sin novedad</option><option value="SIN_JUSTIFICAR" ${STATE.historialFiltroEstado === 'SIN_JUSTIFICAR' ? 'selected' : ''}>Sin justificar</option><option value="JUSTIFICADO" ${STATE.historialFiltroEstado === 'JUSTIFICADO' ? 'selected' : ''}>Justificadas</option></select>
                </div>
                <div id="suite-historial-lista" class="suite-scroll-plata" style="overflow-y:auto;min-height:0;flex:1;padding-right:5px;overscroll-behavior:contain;user-select:text;">${this.construirTarjetasHistorial()}</div>
            </div>`;
            const lista = k.querySelector('#suite-historial-lista');
            if (lista) lista.scrollTop = Math.min(scrollAnterior, Math.max(0, lista.scrollHeight - lista.clientHeight));
            this.aplicarTemaEnElemento(k);
        },

        abrirInteraccionNormal() {
            document.getElementById('suite-interaccion-normal')?.remove();
            const valores = INTERACCION_NORMAL.valores;
            const modal = document.createElement('div');
            modal.id = 'suite-interaccion-normal';
            modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.65);display:grid;place-items:center;padding:18px;box-sizing:border-box;font-family:Inter,-apple-system,sans-serif;";
            modal.innerHTML = `<form style="width:min(420px,100%);max-height:90vh;overflow:auto;padding:22px;box-sizing:border-box;border-radius:18px;background:var(--sd-panel-bg,#0f172a);color:var(--sd-texto,#f8fafc);border:1px solid var(--sd-borde,#334155);box-shadow:0 24px 70px #0008;">
                <div style="font-size:18px;font-weight:850;margin-bottom:8px;">Interacción normal</div>
                <p style="font-size:12px;line-height:1.6;color:var(--sd-tenue,#94a3b8);margin:0 0 18px;">El contador sube desde cero. El AHT acumula la duración total del chat. Los avisos se cuentan desde tu última respuesta.</p>
                <label style="display:block;font-size:12px;margin-bottom:14px;">Primer aviso (minutos)
                    <input name="aviso" class="suite-input-plata" type="number" min="1" max="239" step="1" required value="${valores.avisoMin}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;"></label>
                <label style="display:block;font-size:12px;margin-bottom:14px;">Sin respuesta · rojo (minutos)
                    <input name="sinRespuesta" class="suite-input-plata" type="number" min="2" max="240" step="1" required value="${valores.sinRespuestaMin}" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;"></label>
                <p style="font-size:12px;line-height:1.6;">Cuando el cliente responde, el contador vuelve a 0 y muestra <b>En espera de respuesta</b>, sin avisos de seguimiento.</p>
                <p style="font-size:11px;color:var(--sd-tenue,#94a3b8);">Los cambios se aplican también a los chats abiertos sin reiniciar sus tiempos y se guardan para tu cuenta en este navegador.</p>
                <div role="alert" id="suite-interaccion-error" style="color:#fca5a5;font-size:12px;margin:12px 0;"></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button type="submit" class="suite-boton-plata">Guardar tiempos</button>
                    <button type="button" data-normal-restablecer class="suite-boton-plata secundario">Usar 5 y 12 min</button>
                    <button type="button" data-normal-cerrar class="suite-boton-plata secundario">Cerrar</button>
                </div>
            </form>`;
            document.body.appendChild(modal);
            this.aplicarTemaEnElemento(modal);
            const form = modal.querySelector('form');
            form.addEventListener('submit', e => {
                e.preventDefault();
                try {
                    INTERACCION_NORMAL.guardar(Number(form.elements.aviso.value), Number(form.elements.sinRespuesta.value));
                    MOTOR_CRONOMETROS_V2.tick();
                    STATE.guardarEnDisco();
                    COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas');
                    modal.remove();
                    this.renderizarSelectorTema();
                    this.mostrarToast('Tiempos de interacción guardados');
                } catch (error) { modal.querySelector('#suite-interaccion-error').textContent = error.message || 'No se pudieron guardar los tiempos.'; }
            });
            modal.querySelector('[data-normal-restablecer]').onclick = () => {
                form.elements.aviso.value = '5'; form.elements.sinRespuesta.value = '12';
            };
            modal.querySelector('[data-normal-cerrar]').onclick = () => modal.remove();
            modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
            modal.addEventListener('keydown', e => { if (e.key === 'Escape') modal.remove(); });
            form.elements.aviso.focus();
        },

        renderizarSelectorTema() {
            const k = DOM.kb; if (!k || STATE.posKB.minimizado) return;
            const tarjetasPaleta = Object.entries(PALETAS_VISUALES).map(([id, paleta]) => {
                const activa = STATE.estiloVisual === id;
                return `<button class="suite-paleta-opcion ${activa ? 'activa' : ''}" data-action="cambiar-estilo" data-estilo="${id}" aria-pressed="${activa}"><span class="suite-paleta-muestra" style="--m1:${paleta.muestra[0]};--m2:${paleta.muestra[1]};--m3:${paleta.muestra[2]};"><i></i><i></i><i></i></span><b>${paleta.icono} ${paleta.nombre}</b><small>${paleta.subtitulo}</small></button>`;
            }).join('');
            const tarjetaModo = (tema, icono, titulo, detalle) => {
                const activo = STATE.tema === tema;
                return `<button class="tarjeta-tema-plata ${activo ? 'activo' : ''}" data-action="cambiar-tema" data-tema="${tema}" aria-pressed="${activo}" style="width:100%;display:flex;align-items:center;gap:12px;background:${activo ? 'var(--sd-acento-suave)' : 'var(--sd-tarjeta)'};color:var(--sd-texto);border:1px solid ${activo ? 'var(--sd-acento)' : 'var(--sd-borde)'};border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;text-align:left;"><span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:11px;background:var(--sd-campo);font-size:18px;">${icono}</span><span style="display:flex;flex-direction:column;gap:4px;"><b style="font-size:11px;">${titulo}</b><small style="font-size:8px;color:var(--sd-tenue);">${detalle}</small></span><span style="margin-left:auto;font-size:15px;color:${activo ? 'var(--sd-acento)' : 'var(--sd-tenue)'};">${activo ? '●' : '○'}</span></button>`;
            };
            const panelActivo = STATE.panelCronometrosVisible;
            const interruptorPanel = `<button class="tarjeta-tema-plata ${panelActivo ? 'activo' : ''}" data-action="alternar-panel-cronometros" style="width:100%;display:flex;align-items:center;gap:12px;background:${panelActivo ? 'var(--sd-acento-suave)' : 'var(--sd-tarjeta)'};color:var(--sd-texto);border:1px solid ${panelActivo ? 'var(--sd-acento)' : 'var(--sd-borde)'};border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;text-align:left;"><span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:11px;background:var(--sd-campo);font-size:18px;">◷</span><span style="display:flex;flex-direction:column;gap:4px;min-width:0;"><b style="font-size:11px;">Panel flotante de cronómetros</b><small style="font-size:8px;color:var(--sd-tenue);line-height:1.4;">${panelActivo ? 'Visible junto al CRM.' : 'Oculto; los tiempos continúan activos.'}</small></span><span style="margin-left:auto;width:38px;height:21px;border-radius:999px;padding:3px;box-sizing:border-box;background:${panelActivo ? 'var(--sd-acento)' : '#64748b'};display:flex;justify-content:${panelActivo ? 'flex-end' : 'flex-start'};align-items:center;flex:0 0 auto;"><span style="width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 2px 5px rgba(0,0,0,.25);"></span></span></button>`;
            const botonRestablecer = `<button class="tarjeta-tema-plata" data-action="restablecer-posiciones-paneles" style="width:100%;display:flex;align-items:center;gap:12px;background:var(--sd-tarjeta);color:var(--sd-texto);border:1px solid var(--sd-borde);border-radius:12px;padding:12px;margin-bottom:15px;cursor:pointer;text-align:left;"><span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:11px;background:var(--sd-campo);font-size:18px;">↺</span><span style="display:flex;flex-direction:column;gap:4px;min-width:0;"><b style="font-size:11px;">Restablecer posiciones</b><small style="font-size:8px;color:var(--sd-tenue);line-height:1.4;">Devuelve todas las ventanas flotantes a lugares visibles y tamaños seguros.</small></span><span style="margin-left:auto;color:var(--sd-acento);font-size:17px;">›</span></button>`;
            const resumenActualizacion = ACTUALIZADOR_SUITE.resumen();
            const tarjetaActualizacion = `<div id="suite-actualizador-tarjeta" class="suite-tarjeta-plata" style="margin-bottom:12px;padding:11px;border-color:${ACTUALIZADOR_SUITE.disponible ? 'var(--sd-acento)' : 'var(--sd-borde)'};"><div style="display:flex;align-items:center;gap:10px;"><span style="width:34px;height:34px;display:grid;place-items:center;border-radius:10px;background:var(--sd-acento-suave);color:var(--sd-acento);font-size:15px;">↥</span><span style="min-width:0;flex:1;"><b id="suite-actualizador-estado" style="display:block;font-size:10px;">${UTILS.escaparHTML(resumenActualizacion.estado)}</b><small id="suite-actualizador-detalle" style="display:block;font-size:8px;color:var(--sd-tenue);line-height:1.45;margin-top:3px;">${UTILS.escaparHTML(resumenActualizacion.detalle)}</small></span><button id="suite-actualizador-boton" class="suite-boton-plata ${ACTUALIZADOR_SUITE.disponible ? '' : 'secundario'}" data-action="actualizar-suite" ${ACTUALIZADOR_SUITE.comprobando ? 'disabled' : ''} style="padding:8px 9px;white-space:nowrap;">${UTILS.escaparHTML(resumenActualizacion.accion)}</button></div></div>`;
            const diagnostico = RENDIMIENTO.resumen();
            const filaDiagnostico = (etiqueta, id, valor) => `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid color-mix(in srgb,var(--sd-borde) 55%,transparent);"><span style="font-size:8px;color:var(--sd-tenue);">${etiqueta}</span><b id="${id}" style="font-size:8px;color:var(--sd-texto);text-align:right;">${valor}</b></div>`;
            const medidor = `<div id="suite-medidor-rendimiento" class="suite-tarjeta-plata" style="margin-bottom:12px;"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px;"><span class="suite-eyebrow-plata">Diagnóstico interno</span><b id="suite-rend-estado" style="font-size:9px;color:${diagnostico.estado.color};">${diagnostico.estado.texto}</b></div>${filaDiagnostico('Actualización promedio','suite-rend-promedio',`${diagnostico.promedio.toFixed(2)} ms`)}${filaDiagnostico('Actualización máxima','suite-rend-maximo',`${diagnostico.maximo.toFixed(2)} ms`)}${filaDiagnostico('Pintados evitados','suite-rend-cola',RENDIMIENTO.actualizacionesAgrupadas)}${filaDiagnostico('Reutilización del CRM','suite-rend-cache',`${diagnostico.porcentajeCache}%`)}${filaDiagnostico('Pausas recuperadas','suite-rend-pausas',diagnostico.pausas)}${filaDiagnostico('Ventanas recuperadas','suite-rend-ventanas',RENDIMIENTO.recuperacionesVentanas)}<div style="padding-top:7px;font-size:7px;color:var(--sd-tenue);line-height:1.45;">Último error: <span id="suite-rend-error">${UTILS.escaparHTML(RENDIMIENTO.ultimoError || 'Ninguno')}</span></div></div>`;
            k.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;box-sizing:border-box">${this.cabeceraHerramientas()}<div class="suite-scroll-plata" style="overflow-y:auto;min-height:0;flex:1;padding-right:3px;"><div class="suite-eyebrow-plata" style="margin:2px 0 9px;">Actualizaciones</div>${tarjetaActualizacion}<div class="suite-eyebrow-plata" style="margin:2px 0 9px;">Estilo visual</div><div class="suite-paletas-grid">${tarjetasPaleta}</div><div class="suite-eyebrow-plata" style="margin-bottom:9px;">Modo de iluminación</div>${tarjetaModo('oscuro','🌙','Modo oscuro','Versión nocturna de la paleta seleccionada.')}${tarjetaModo('claro','☀️','Modo claro','Versión luminosa de la misma identidad.')}<div class="suite-eyebrow-plata" style="margin:15px 0 9px;">Cronómetros</div><button type="button" class="suite-tarjeta-plata" data-action="interaccion-normal" style="display:block;width:100%;text-align:left;margin-bottom:12px;color:var(--sd-texto);cursor:pointer;"><b style="font-size:12px;">◷ Interacción normal</b><span style="display:block;font-size:10px;color:var(--sd-tenue);margin-top:6px;">Primer aviso: ${INTERACCION_NORMAL.valores.avisoMin} min · Sin respuesta: ${INTERACCION_NORMAL.valores.sinRespuestaMin} min</span><span style="display:block;font-size:9px;color:var(--sd-acento);margin-top:5px;">Modificar tiempos →</span></button>${medidor}<div class="suite-eyebrow-plata" style="margin:8px 0 9px;">Paneles</div>${interruptorPanel}${botonRestablecer}<div style="font-size:8px;color:var(--sd-tenue);line-height:1.5;padding:4px;">La configuración se guarda para ${UTILS.escaparHTML(AUTH_MANAGER.usuario?.email || 'este agente')} en este navegador.</div></div></div>`;
            this.aplicarTemaEnElemento(k);
            RENDIMIENTO.actualizarVista();
        },

        actualizarAvisoActualizacion() {
            const resumen = ACTUALIZADOR_SUITE.resumen();
            const chip = document.getElementById('suite-version-chip');
            if (chip) {
                chip.textContent = ACTUALIZADOR_SUITE.disponible ? `↥ ${ACTUALIZADOR_SUITE.versionRemota}` : `v${SUITE_VERSION}`;
                chip.title = ACTUALIZADOR_SUITE.disponible ? `Actualizar Sistema Dual a ${ACTUALIZADOR_SUITE.versionRemota}` : 'Comprobar actualizaciones';
                chip.style.setProperty('color', ACTUALIZADOR_SUITE.disponible ? 'var(--sd-acento2)' : 'var(--sd-tenue)', 'important');
                chip.style.setProperty('border-color', ACTUALIZADOR_SUITE.disponible ? 'var(--sd-acento)' : 'var(--sd-borde)', 'important');
            }
            const minimizada = document.getElementById('suite-version-minimizada');
            if (minimizada) minimizada.textContent = `Centro de control · ${ACTUALIZADOR_SUITE.disponible ? `${ACTUALIZADOR_SUITE.versionRemota} disponible` : `v${SUITE_VERSION}`}`;
            const tarjeta = document.getElementById('suite-actualizador-tarjeta');
            const estado = document.getElementById('suite-actualizador-estado');
            const detalle = document.getElementById('suite-actualizador-detalle');
            const boton = document.getElementById('suite-actualizador-boton');
            if (tarjeta) tarjeta.style.setProperty('border-color', ACTUALIZADOR_SUITE.disponible ? 'var(--sd-acento)' : 'var(--sd-borde)', 'important');
            if (estado) estado.textContent = resumen.estado;
            if (detalle) detalle.textContent = resumen.detalle;
            if (boton) {
                boton.textContent = resumen.accion;
                boton.disabled = ACTUALIZADOR_SUITE.comprobando;
                boton.classList.toggle('secundario', !ACTUALIZADOR_SUITE.disponible);
            }
        },
        obtenerPaletaVisual(estilo = STATE.estiloVisual, tema = STATE.tema) {
            const grupo = PALETAS_VISUALES[estilo] || PALETAS_VISUALES.verde;
            return grupo[tema === 'claro' ? 'claro' : 'oscuro'];
        },
        aplicarVariablesPaleta() {
            if (!document.body) return;
            const paleta = this.obtenerPaletaVisual();
            const claro = STATE.tema === 'claro';
            const variables = {
                '--sd-panel-bg': `linear-gradient(145deg,${paleta.panel},${paleta.panel2})`,
                '--sd-panel2': paleta.panel2,
                '--sd-texto': paleta.texto,
                '--sd-tenue': paleta.tenue,
                '--sd-borde': paleta.borde,
                '--sd-tarjeta': paleta.tarjeta,
                '--sd-tarjeta-hover': paleta.tarjetaHover,
                '--sd-campo': paleta.campo,
                '--sd-acento': paleta.acento,
                '--sd-acento2': paleta.acento2,
                '--sd-tinta-acento': paleta.tinta,
                '--sd-acento-contraste': claro ? paleta.acento2 : paleta.texto,
                '--sd-acento-suave': `color-mix(in srgb,${paleta.acento} 16%,transparent)`,
                '--sd-boton-activo-bg': `linear-gradient(145deg,${paleta.acento},${paleta.panel2})`,
                '--sd-sombra': paleta.sombra,
                '--sd-scroll-track': paleta.scrollTrack
            };
            Object.entries(variables).forEach(([nombre, valor]) => document.body.style.setProperty(nombre, valor));
            document.body.dataset.suiteEstilo = STATE.estiloVisual;
            document.body.dataset.suiteTema = STATE.tema;
        },
        aplicarTemaEnElemento(elemento) {
            if (!elemento) return;
            elemento.style.setProperty('background', 'var(--sd-panel-bg)', 'important');
            elemento.style.setProperty('color', 'var(--sd-texto)', 'important');
            elemento.style.setProperty('border-color', 'var(--sd-borde)', 'important');
            elemento.style.setProperty('box-shadow', 'var(--sd-sombra), inset 0 1px rgba(255,255,255,.065)', 'important');
        },
        aplicarTemaVisual() {
            if (!document.body) return;
            this.aplicarVariablesPaleta();
            document.body.classList.toggle('plata-tema-claro', STATE.tema === 'claro');
            [DOM.reloj, DOM.panel, DOM.ventana, DOM.kb, DOM.blocNotas].forEach(el => this.aplicarTemaEnElemento(el));
        },
        obtenerPanelesParaBarridoTema() {
            const candidatos = [
                DOM.reloj, DOM.panel, DOM.ventana, DOM.kb, DOM.blocNotas, DOM.btnModoLlamadas,
                document.querySelector('#modal-editor-scripts-plata > .suite-scroll-plata'),
                document.querySelector('#suite-paleta-comandos .suite-paleta-caja'),
                document.querySelector('#suite-llamadas-pendientes .suite-paleta-caja'),
                document.getElementById('panel-emergencia-chats-plata')
            ];
            return [...new Set(candidatos)].filter(elemento => {
                if (!elemento?.isConnected) return false;
                const estilo = getComputedStyle(elemento);
                const rect = elemento.getBoundingClientRect();
                return estilo.display !== 'none' && estilo.visibility !== 'hidden' && rect.width > 2 && rect.height > 2;
            });
        },
        cancelarAnimacionTema(aplicarPendiente = true) {
            if (this.escuchaCancelarTema) {
                document.removeEventListener('pointerdown', this.escuchaCancelarTema, true);
                this.escuchaCancelarTema = null;
            }
            const pendiente = this.cambioTemaPendiente;
            this.cambioTemaPendiente = null;
            this.tokenAnimacionTema = null;
            if (aplicarPendiente && pendiente && !pendiente.aplicado) {
                pendiente.aplicado = true;
                pendiente.aplicar();
            }
            (this.animacionesTemaPanel || []).forEach(animacion => { try { animacion.cancel(); } catch {} });
            this.animacionesTemaPanel = [];
            document.querySelectorAll('.vista-previa-tema-panel-plata').forEach(el => el.remove());
        },
        vigilarInteraccionDuranteTema() {
            if (this.escuchaCancelarTema) document.removeEventListener('pointerdown', this.escuchaCancelarTema, true);
            this.escuchaCancelarTema = evento => {
                if (evento.target?.closest?.('[data-action="cambiar-tema"],[data-action="cambiar-estilo"]')) return;
                this.cancelarAnimacionTema(true);
            };
            document.addEventListener('pointerdown', this.escuchaCancelarTema, true);
        },
        aplicarPaletaTemporal(elemento, estilo, tema) {
            if (!elemento) return;
            const paleta = this.obtenerPaletaVisual(estilo, tema);
            const claro = tema === 'claro';
            const variables = {
                '--sd-panel-bg': `linear-gradient(145deg,${paleta.panel},${paleta.panel2})`,
                '--sd-panel2': paleta.panel2,
                '--sd-texto': paleta.texto,
                '--sd-tenue': paleta.tenue,
                '--sd-borde': paleta.borde,
                '--sd-tarjeta': paleta.tarjeta,
                '--sd-tarjeta-hover': paleta.tarjetaHover,
                '--sd-campo': paleta.campo,
                '--sd-acento': paleta.acento,
                '--sd-acento2': paleta.acento2,
                '--sd-tinta-acento': paleta.tinta,
                '--sd-acento-contraste': claro ? paleta.acento2 : paleta.texto,
                '--sd-acento-suave': `color-mix(in srgb,${paleta.acento} 16%,transparent)`,
                '--sd-boton-activo-bg': `linear-gradient(145deg,${paleta.acento},${paleta.panel2})`,
                '--sd-sombra': paleta.sombra,
                '--sd-scroll-track': paleta.scrollTrack
            };
            Object.entries(variables).forEach(([nombre, valor]) => elemento.style.setProperty(nombre, valor));
        },
        copiarAparienciaCalculada(origen, copia) {
            const propiedades = [
                'display','position','box-sizing','width','height','min-width','min-height','max-width','max-height',
                'margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left',
                'font','font-family','font-size','font-style','font-weight','line-height','letter-spacing','text-align','text-transform','text-decoration',
                'white-space','word-break','overflow','overflow-x','overflow-y','text-overflow','color','caret-color',
                'background','background-color','background-image','background-position','background-size','background-repeat',
                'border','border-width','border-style','border-color','border-radius','box-shadow','outline','opacity','visibility',
                'flex','flex-basis','flex-direction','flex-grow','flex-shrink','flex-wrap','grid','grid-template-columns','grid-template-rows',
                'grid-column','grid-row','gap','column-gap','row-gap','align-items','align-content','align-self','justify-content','justify-items','justify-self',
                'object-fit','object-position','transform','transform-origin','inset','top','right','bottom','left','z-index'
            ];
            const originales = [origen, ...origen.querySelectorAll('*')];
            const copias = [copia, ...copia.querySelectorAll('*')];
            originales.forEach((nodo, indice) => {
                const destino = copias[indice];
                if (!destino) return;
                const calculado = getComputedStyle(nodo);
                propiedades.forEach(propiedad => destino.style.setProperty(propiedad, calculado.getPropertyValue(propiedad), 'important'));
                destino.removeAttribute('id');
                destino.removeAttribute('data-action');
                destino.removeAttribute('data-suite-drag-handle');
                if ('value' in nodo && 'value' in destino) destino.value = nodo.value;
                if ('checked' in nodo && 'checked' in destino) destino.checked = nodo.checked;
            });
        },
        crearVistasPreviasTema(paneles, puntoX, puntoY, nuevoEstilo, nuevoTema) {
            const cuerpo = document.body;
            const temaAnteriorClaro = cuerpo.classList.contains('plata-tema-claro');
            const estiloDatasetAnterior = cuerpo.dataset.suiteEstilo;
            const temaDatasetAnterior = cuerpo.dataset.suiteTema;
            const vistas = [];
            try {
                this.aplicarPaletaTemporal(cuerpo, nuevoEstilo, nuevoTema);
                cuerpo.classList.toggle('plata-tema-claro', nuevoTema === 'claro');
                cuerpo.dataset.suiteEstilo = nuevoEstilo;
                cuerpo.dataset.suiteTema = nuevoTema;
                paneles.forEach(panel => {
                    const rect = panel.getBoundingClientRect();
                    const localX = puntoX - rect.left;
                    const localY = puntoY - rect.top;
                    const radio = Math.ceil(Math.max(
                        Math.hypot(localX, localY),
                        Math.hypot(rect.width - localX, localY),
                        Math.hypot(localX, rect.height - localY),
                        Math.hypot(rect.width - localX, rect.height - localY)
                    ));
                    const copia = panel.cloneNode(true);
                    this.copiarAparienciaCalculada(panel, copia);
                    copia.classList.add('vista-previa-tema-panel-plata');
                    copia.setAttribute('aria-hidden', 'true');
                    copia.style.setProperty('top', `${rect.top}px`, 'important');
                    copia.style.setProperty('left', `${rect.left}px`, 'important');
                    copia.style.setProperty('right', 'auto', 'important');
                    copia.style.setProperty('bottom', 'auto', 'important');
                    copia.style.setProperty('width', `${rect.width}px`, 'important');
                    copia.style.setProperty('height', `${rect.height}px`, 'important');
                    copia.style.setProperty('animation', 'none', 'important');
                    copia.style.setProperty('transition', 'none', 'important');
                    copia.style.setProperty('resize', 'none', 'important');
                    copia.style.setProperty('clip-path', `circle(0px at ${localX}px ${localY}px)`);
                    vistas.push({ copia, localX, localY, radio });
                });
            } finally {
                this.aplicarVariablesPaleta();
                cuerpo.classList.toggle('plata-tema-claro', temaAnteriorClaro);
                if (estiloDatasetAnterior === undefined) delete cuerpo.dataset.suiteEstilo;
                else cuerpo.dataset.suiteEstilo = estiloDatasetAnterior;
                if (temaDatasetAnterior === undefined) delete cuerpo.dataset.suiteTema;
                else cuerpo.dataset.suiteTema = temaDatasetAnterior;
            }
            return vistas;
        },
        cambiarTemaAnimado(nuevoTema, origenX, origenY, nuevoEstilo = STATE.estiloVisual) {
            if (!['claro','oscuro'].includes(nuevoTema) || !PALETAS_VISUALES[nuevoEstilo]) return;
            this.cancelarAnimacionTema(true);
            if (nuevoTema === STATE.tema && nuevoEstilo === STATE.estiloVisual) return;
            const rectKB = DOM.kb?.getBoundingClientRect();
            const puntoX = Number.isFinite(origenX) ? origenX : (rectKB ? rectKB.left + rectKB.width / 2 : window.innerWidth / 2);
            const puntoY = Number.isFinite(origenY) ? origenY : (rectKB ? rectKB.top + rectKB.height / 2 : window.innerHeight / 2);
            const paneles = this.obtenerPanelesParaBarridoTema();
            const aplicarCambio = () => {
                STATE.tema = nuevoTema;
                STATE.estiloVisual = nuevoEstilo;
                localStorage.setItem('tema_suite_plata_v1', nuevoTema);
                localStorage.setItem(CLAVE_USUARIO('tema_suite_plata_v2'), nuevoTema);
                localStorage.setItem(CLAVE_USUARIO('estilo_visual_suite_plata_v1'), nuevoEstilo);
                this.aplicarTemaVisual();
                if (STATE.posKB.vista === 'tema' && !STATE.posKB.minimizado) this.renderizarSelectorTema();
            };
            if (!paneles.length) {
                aplicarCambio();
                return;
            }
            const vistas = this.crearVistasPreviasTema(paneles, puntoX, puntoY, nuevoEstilo, nuevoTema);
            const token = {};
            this.tokenAnimacionTema = token;
            this.cambioTemaPendiente = { aplicar:aplicarCambio, aplicado:false };
            vistas.forEach(({ copia }) => document.body.appendChild(copia));
            const animaciones = vistas.map(({ copia, localX, localY, radio }) => copia.animate(
                { clipPath:[`circle(0px at ${localX}px ${localY}px)`, `circle(${radio}px at ${localX}px ${localY}px)`] },
                { duration:3000, easing:'cubic-bezier(.22,.72,.18,1)', fill:'forwards' }
            ));
            this.animacionesTemaPanel = animaciones;
            this.vigilarInteraccionDuranteTema();
            Promise.allSettled(animaciones.map(animacion => animacion.finished)).then(() => {
                if (this.tokenAnimacionTema !== token) return;
                const pendiente = this.cambioTemaPendiente;
                if (pendiente && !pendiente.aplicado) {
                    pendiente.aplicado = true;
                    pendiente.aplicar();
                }
                vistas.forEach(({ copia }) => copia.remove());
                this.tokenAnimacionTema = null;
                this.cambioTemaPendiente = null;
                this.animacionesTemaPanel = [];
                if (this.escuchaCancelarTema) {
                    document.removeEventListener('pointerdown', this.escuchaCancelarTema, true);
                    this.escuchaCancelarTema = null;
                }
            });
        },

        aplicarDimensionesRespuestas() {
            const v = DOM.ventana;
            if (!v) return;
            v.style = CONFIG.ESTILO_GLASSMORPHISM;
            v.style.setProperty('position', 'fixed', 'important');
            v.style.setProperty('top', STATE.posRespuestas.top, 'important');
            v.style.setProperty('left', STATE.posRespuestas.left, 'important');

            if (STATE.posRespuestas.minimizado) {
                v.style.setProperty('padding', '12px 18px', 'important');
                v.style.setProperty('width', '180px', 'important');
                v.style.setProperty('height', '45px', 'important');
                v.style.setProperty('resize', 'none', 'important');
                v.style.setProperty('overflow', 'hidden', 'important');
            } else {
                v.style.setProperty('padding', '14px', 'important');
                v.style.setProperty('width', STATE.posRespuestas.width, 'important');
                v.style.setProperty('height', STATE.posRespuestas.height, 'important');
                v.style.setProperty('resize', 'both', 'important');
                v.style.setProperty('overflow', 'hidden', 'important');
            }
            this.aplicarTemaEnElemento(v);
        },

        // =========================================================================
        // MÓDULO BLOC DE NOTAS / LLAMADAS
        // =========================================================================
        crearPanelBlocNotasLlamadas() {
            if (document.getElementById("panel-bloc-notas-llamadas")) return;
            DOM.blocNotas = document.createElement('div');
            DOM.blocNotas.id = "panel-bloc-notas-llamadas";
            DOM.blocNotas.style = CONFIG.ESTILO_GLASSMORPHISM;
            this.aplicarDimensionesBlocNotas();
            document.body.appendChild(DOM.blocNotas);
            this.hacerArrastrable(DOM.blocNotas, 'pos_bloc_notas_plata_v1', 'blocNotas');
            this.renderizarContenidoBlocNotas();
        },

        aplicarDimensionesBlocNotas() {
            const b = DOM.blocNotas;
            if (!b) return;
            b.style.setProperty('position', 'fixed', 'important');
            b.style.setProperty('top', STATE.posBlocNotas.top, 'important');
            b.style.setProperty('left', STATE.posBlocNotas.left, 'important');

            if (STATE.posBlocNotas.minimizado) {
                b.style.setProperty('padding', '10px 14px', 'important');
                b.style.setProperty('width', '220px', 'important');
                b.style.setProperty('height', '45px', 'important');
                b.style.setProperty('resize', 'none', 'important');
                b.style.setProperty('overflow', 'hidden', 'important');
            } else {
                b.style.setProperty('padding', '14px', 'important');
                b.style.setProperty('width', STATE.posBlocNotas.width, 'important');
                b.style.setProperty('height', STATE.posBlocNotas.height, 'important');
                b.style.setProperty('resize', 'both', 'important');
                b.style.setProperty('overflow', 'hidden', 'important');
            }
        },

        renderizarContenidoBlocNotas() {
            if (!DOM.blocNotas) return;

            if (STATE.posBlocNotas.minimizado) {
                DOM.blocNotas.innerHTML = `
                    <div data-suite-drag-handle="true" style="display: flex; justify-content: space-between; align-items: center; width: 100%; height: 100%;">
                        <span style="font-size:11px;font-weight:bold;color:var(--sd-acento);letter-spacing:.05em;">📞 MODULO LLAMADAS</span>
                        <button data-action="minimizar-bloc-notas" style="background:var(--sd-acento-suave);border:1px solid var(--sd-acento);color:var(--sd-acento-contraste);font-size:10px;font-weight:bold;padding:2px 8px;border-radius:6px;cursor:pointer;">Max</button>
                    </div>`;
                return;
            }

            const clienteDetectado = STATE.clienteActualEnPantalla || "Sin cliente seleccionado";
            const horaActual = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const meses = ["TODOS", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
            const opcionesMeses = meses.map(m => `<option value="${m}" ${STATE.filtroMesLlamadas === m ? 'selected' : ''} style="background:#0f172a; color:#f8fafc;">${m}</option>`).join('');

            // Filtrado de llamadas
            const llamadasFiltradas = STATE.registroLlamadas.filter(item => {
                const cumpleEstado = STATE.filtroEstadoLlamadas === 'TODOS' || item.estado === STATE.filtroEstadoLlamadas;
                const mesItem = new Date(item.fechaISO).toLocaleString('es-ES', { month: 'long' });
                const mesItemCap = mesItem.charAt(0).toUpperCase() + mesItem.slice(1);
                const cumpleMes = STATE.filtroMesLlamadas === 'TODOS' || mesItemCap === STATE.filtroMesLlamadas;
                return cumpleEstado && cumpleMes;
            });

            const htmlListaLlamadas = llamadasFiltradas.length === 0
                ? `<div style="color: #64748b; font-size: 10px; text-align: center; padding: 12px;">No hay registros de llamadas.</div>`
                : llamadasFiltradas.map((item) => {
                    const clienteSeguro = UTILS.escaparHTML(item.cliente);
                    const horaSegura = UTILS.escaparHTML(item.horaEntrada);
                    const idSeguro = UTILS.escaparHTML(item.id);
                    const idLlamadaSeguro = UTILS.escaparHTML(item.idLlamada || '');
                    const notasSeguras = UTILS.escaparHTML(item.notas || '');
                    const inicioLlamada = new Date(item.inicioISO || item.fechaISO || 0);
                    const finLlamada = item.finISO ? new Date(item.finISO) : null;
                    const detalleTiempo = `${Number.isNaN(inicioLlamada.getTime()) ? item.horaEntrada : inicioLlamada.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${finLlamada && !Number.isNaN(finLlamada.getTime()) ? finLlamada.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'En curso'} · ${UTILS.formatearTiempo(Number(item.duracionSeg) || 0)}`;
                    const colorEstado = item.estado === 'JUSTIFICADO' ? '#34d399' : item.estado === 'SIN_JUSTIFICAR' ? '#fca5a5' : item.estado === 'EN_CURSO' ? '#38bdf8' : '#fbbf24';
                    return `
                    <div class="tarjeta-llamada-plata" style="background: rgba(255, 255, 255, 0.03); border: 1px solid ${item.estado === 'JUSTIFICADO' ? 'rgba(16,185,129,.3)' : item.estado === 'SIN_JUSTIFICAR' ? 'rgba(239,68,68,.3)' : 'rgba(245,158,11,.3)'}; border-radius: 8px; padding: 8px; margin-bottom: 6px; position: relative;">
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: bold; margin-bottom: 4px;">
                            <span style="color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px;" title="${clienteSeguro}">👤 ${clienteSeguro}</span>
                            <div style="display: flex; align-items: center; gap: 4px;">
                                <span style="color: #94a3b8; font-size: 8px; margin-right: 2px;">🕒 ${UTILS.escaparHTML(detalleTiempo)}</span>
                                <button data-action="editar-nombre-cliente-llamada" data-id="${idSeguro}" title="Modificar nombre del cliente" style="background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; border-radius: 4px; padding: 1px 5px; font-size: 10px; cursor: pointer;">✏️</button>
                                <button data-action="eliminar-llamada-individual" data-id="${idSeguro}" title="Eliminar registro de llamada" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; border-radius: 4px; padding: 1px 5px; font-size: 10px; cursor: pointer;">🗑️</button>
                            </div>
                        </div>
                        <div style="display: flex; gap: 4px; margin-bottom: 4px;">
                            <input type="text" data-action="actualizar-id-llamada" data-id="${idSeguro}" value="${idLlamadaSeguro}" placeholder="Pegar ID..." style="flex-grow: 1; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: #38bdf8; font-family: monospace; font-size: 10px; padding: 4px; border-radius: 4px; outline: none;" />
                            <select data-action="cambiar-estado-llamada" data-id="${idSeguro}" style="background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: ${colorEstado}; font-size: 9px; border-radius: 4px; padding: 2px;">
                                <option value="EN_CURSO" ${item.estado === 'EN_CURSO' ? 'selected' : ''}>En curso</option>
                                <option value="SIN_NOVEDAD" ${item.estado === 'SIN_NOVEDAD' ? 'selected' : ''}>Sin novedad</option>
                                <option value="SIN_JUSTIFICAR" ${item.estado === 'SIN_JUSTIFICAR' ? 'selected' : ''}>Sin Justificar</option>
                                <option value="JUSTIFICADO" ${item.estado === 'JUSTIFICADO' ? 'selected' : ''}>Justificado</option>
                            </select>
                        </div>
                        <textarea data-action="actualizar-notas-llamada" data-id="${idSeguro}" placeholder="Notas de la llamada..." style="width: 100%; height: 36px; background: #1e293b; border: 1px solid rgba(255,255,255,0.05); color: #e2e8f0; font-size: 10px; border-radius: 4px; padding: 4px; resize: none; box-sizing: border-box; outline: none;">${notasSeguras}</textarea>
                    </div>
                `;
                }).join('');

            const htmlFirmaFijaBloc = `
                <div style="display: flex; justify-content: flex-end; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 6px; margin-top: auto; box-sizing: border-box; height: 18px;">
                    <div style="font-size: 9px; color: rgba(16, 185, 129, 0.7); letter-spacing: 0.08em; text-transform: uppercase; font-weight: bold; pointer-events: none;">
                        By Aldair Valdivia
                    </div>
                </div>`;

            DOM.blocNotas.innerHTML = `
                <div style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
                    <div data-suite-drag-handle="true" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px; margin-bottom: 10px; height: 28px; box-sizing: border-box;">
                        <span style="font-size: 11px; font-weight: bold; color: #38bdf8;">📞 REGISTRO DE LLAMADAS</span>
                        <button data-action="minimizar-bloc-notas" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 9px; padding: 3px 8px; border-radius: 6px; cursor: pointer;">Min</button>
                    </div>
                    <!-- NOTA INSTRUCTIVA -->
                    <div style="background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 6px 8px; font-size: 9px; color: #38bdf8; margin-bottom: 10px; line-height: 1.3;">
                        <b>💡 Estados:</b> las llamadas terminan como Sin novedad. Usa Sin justificar solo cuando exista una incidencia y Justificado al documentarla.
                    </div>
                    <!-- FORMULARIO NUEVA LLAMADA -->
                    <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px; margin-bottom: 10px;">
                        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 6px; color: #94a3b8;">
                            <span>Cliente: <b style="color: #f8fafc;">${UTILS.escaparHTML(clienteDetectado)}</b></span>
                            <span>Hora: <b style="color: #34d399;">${horaActual}</b></span>
                        </div>
                        <button id="btn-registrar-llamada-nueva" style="width: 100%; background: #0284c7; border: none; color: white; padding: 6px; border-radius: 6px; font-size: 10px; font-weight: bold; cursor: pointer;">+ Registrar Nueva Llamada Entrante</button>
                    </div>
                    <!-- FILTROS -->
                    <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                        <select id="filtro-mes-llamada" style="flex: 1; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: #f8fafc; font-size: 9px; border-radius: 6px; padding: 4px;">
                            ${opcionesMeses}
                        </select>
                        <select id="filtro-estado-llamada" style="flex: 1; background: #1e293b; border: 1px solid rgba(255,255,255,0.1); color: #f8fafc; font-size: 9px; border-radius: 6px; padding: 4px;">
                            <option value="TODOS" ${STATE.filtroEstadoLlamadas === 'TODOS' ? 'selected' : ''}>Todos los Estados</option>
                            <option value="EN_CURSO" ${STATE.filtroEstadoLlamadas === 'EN_CURSO' ? 'selected' : ''}>En curso</option>
                            <option value="SIN_NOVEDAD" ${STATE.filtroEstadoLlamadas === 'SIN_NOVEDAD' ? 'selected' : ''}>Sin novedad</option>
                            <option value="SIN_JUSTIFICAR" ${STATE.filtroEstadoLlamadas === 'SIN_JUSTIFICAR' ? 'selected' : ''}>Sin Justificar</option>
                            <option value="JUSTIFICADO" ${STATE.filtroEstadoLlamadas === 'JUSTIFICADO' ? 'selected' : ''}>Justificados</option>
                        </select>
                    </div>
                    <!-- LISTADO SCROLL -->
                    <div id="scroll-llamadas" style="flex-grow: 1; overflow-y: auto; padding-right: 2px; margin-bottom: 6px;">
                        ${htmlListaLlamadas}
                    </div>
                    ${htmlFirmaFijaBloc}
                </div>
            `;

            // Enlazar eventos de los filtros y botón dentro del bloc
            const btnReg = document.getElementById('btn-registrar-llamada-nueva');
            if (btnReg) {
                btnReg.onclick = () => {
                    const uidDetectado = UTILS.extraerUIDClienteActual() || STATE.obtenerUIDPendiente();
                    const nueva = {
                        id: 'call_' + Date.now(),
                        cliente: STATE.clienteActualEnPantalla || "Cliente General",
                        horaEntrada: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        fechaISO: new Date().toISOString(),
                        idLlamada: uidDetectado,
                        notas: "",
                        inicioISO: new Date().toISOString(),
                        finISO: new Date().toISOString(),
                        duracionSeg: 0,
                        tipo: 'LLAMADA',
                        correoAgente: AUTH_MANAGER.usuario?.email || '',
                        estado: "SIN_NOVEDAD"
                    };
                    if (uidDetectado) STATE.limpiarUIDPendiente();
                    STATE.registroLlamadas.unshift(nueva);
                    STATE.guardarLlamadasDisco();
                    this.renderizarContenidoBlocNotas();
                };
            }

            const selMes = document.getElementById('filtro-mes-llamada');
            if (selMes) {
                selMes.onchange = (e) => {
                    STATE.filtroMesLlamadas = e.target.value;
                    this.renderizarContenidoBlocNotas();
                };
            }

            const selEst = document.getElementById('filtro-estado-llamada');
            if (selEst) {
                selEst.onchange = (e) => {
                    STATE.filtroEstadoLlamadas = e.target.value;
                    this.renderizarContenidoBlocNotas();
                };
            }
        },

        mostrarLlamadasPendientes() {
            document.getElementById('suite-llamadas-pendientes')?.remove();
            const pendientes = (STATE.registroLlamadas || []).filter(item => item.estado === 'SIN_JUSTIFICAR');
            const modal = document.createElement('div');
            modal.id = 'suite-llamadas-pendientes';
            modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(2,6,23,.68);backdrop-filter:blur(7px);display:grid;place-items:center;padding:20px;font-family:Inter,-apple-system,sans-serif;';
            const filas = pendientes.length ? pendientes.map(item => {
                const inicio = new Date(item.inicioISO || item.fechaISO || 0);
                const fin = item.finISO ? new Date(item.finISO) : null;
                const fecha = Number.isNaN(inicio.getTime()) ? 'Fecha no disponible' : inicio.toLocaleString('es-MX');
                const horaFin = fin && !Number.isNaN(fin.getTime()) ? fin.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : 'En curso';
                return `<div class="suite-tarjeta-plata" style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:11px">${UTILS.escaparHTML(item.cliente || 'Cliente')}</b><span class="suite-chip-plata">Sin justificar</span></div><div style="font-size:8px;color:#94a3b8;line-height:1.55;margin-top:6px">Entrada: ${UTILS.escaparHTML(fecha)}<br>Salida: ${UTILS.escaparHTML(horaFin)} · Duración: ${UTILS.formatearTiempo(Number(item.duracionSeg)||0)}<br>Agente: ${UTILS.escaparHTML(item.correoAgente || AUTH_MANAGER.usuario?.email || '')}</div><div style="font-size:8px;color:#c4b5fd;word-break:break-all;margin-top:5px">ID: ${UTILS.escaparHTML(item.idLlamada || 'Pendiente')}</div><textarea data-action="actualizar-notas-llamada" data-id="${UTILS.escaparHTML(item.id)}" placeholder="Notas de la incidencia..." class="suite-input-plata" style="height:50px;margin-top:7px;resize:vertical">${UTILS.escaparHTML(item.notas || '')}</textarea><div style="display:flex;gap:6px;margin-top:7px"><button data-action="pendiente-copiar-id" data-id="${UTILS.escaparHTML(item.id)}" class="suite-boton-plata secundario" ${item.idLlamada ? '' : 'disabled'}>Copiar ID</button><button data-action="pendiente-marcar-justificada" data-id="${UTILS.escaparHTML(item.id)}" class="suite-boton-plata">Marcar justificada</button><button data-action="pendiente-abrir-modulo" class="suite-boton-plata secundario">Abrir módulo</button></div></div>`;
            }).join('') : `<div style="padding:30px;text-align:center;color:#94a3b8;font-size:10px">No hay llamadas pendientes de justificar.</div>`;
            modal.innerHTML = `<div class="suite-paleta-caja" style="max-width:620px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><div class="suite-eyebrow-plata">Seguimiento</div><b style="font-size:15px">Llamadas pendientes</b></div><button data-action="cerrar-pendientes" class="suite-boton-plata secundario">Cerrar</button></div><div class="suite-scroll-plata" style="overflow:auto;max-height:68vh">${filas}</div></div>`;
            document.body.appendChild(modal);
            this.aplicarTemaEnElemento(modal.querySelector('.suite-paleta-caja'));
        },

        hacerArrastrable(elemento, claveLocalStorage, tipoElemento) {
            elemento.style.setProperty('max-width', '100vw', 'important');
            elemento.style.setProperty('max-height', '100vh', 'important');

            elemento.addEventListener('mousedown', (e) => {
                if (tipoElemento !== 'botonModo') {
                    const asa = e.target.closest('[data-suite-drag-handle="true"]');
                    if (!asa || !elemento.contains(asa)) return;
                    if (e.target.closest('button') || e.target.closest('textarea') || e.target.closest('input') || e.target.closest('select')) {
                        return;
                    }
                }

                const rect = elemento.getBoundingClientRect();
                const esZonaResize = e.clientX > rect.right - 20 && e.clientY > rect.bottom - 20;
                if (esZonaResize) return;

                e.preventDefault();

                const shiftX = e.clientX - rect.left;
                const shiftY = e.clientY - rect.top;

                const mover = (ev) => {
                    ev.preventDefault();

                    const anchoPantalla = window.innerWidth || document.documentElement.clientWidth;
                    const altoPantalla = window.innerHeight || document.documentElement.clientHeight;

                    let nuevoTop = ev.clientY - shiftY;
                    let nuevoLeft = ev.clientX - shiftX;

                    const maxTop = altoPantalla - elemento.offsetHeight;
                    if (nuevoTop < 0) nuevoTop = 0;
                    if (nuevoTop > maxTop) nuevoTop = Math.max(0, maxTop);

                    const maxLeft = anchoPantalla - elemento.offsetWidth;
                    if (nuevoLeft < 0) nuevoLeft = 0;
                    if (nuevoLeft > maxLeft) nuevoLeft = Math.max(0, maxLeft);

                    elemento.style.setProperty('top', nuevoTop + "px", 'important');
                    elemento.style.setProperty('left', nuevoLeft + "px", 'important');
                    elemento.style.setProperty('right', 'auto', 'important');
                    if (tipoElemento === 'panel') {
                        elemento.style.setProperty('bottom', 'auto', 'important');
                    }
                    if (tipoElemento === 'reloj' && STATE.posKB.minimizado) {
                        this.posicionarAccesoSuperior();
                    }
                };

                const detener = () => {
                    window.removeEventListener('mouseup', detener);
                    window.removeEventListener('mousemove', mover);

                    const guardarPos = (ref) => {
                        ref.top = elemento.style.top;
                        ref.left = elemento.style.left;
                        ref.right = 'auto';
                        if (tipoElemento === 'panel') ref.bottom = 'auto';
                        localStorage.setItem(claveLocalStorage, JSON.stringify(ref));
                    };

                    if (tipoElemento === 'respuestas') guardarPos(STATE.posRespuestas);
                    else if (tipoElemento === 'reloj') guardarPos(STATE.posReloj);
                    else if (tipoElemento === 'panel') guardarPos(STATE.posPanel);
                    else if (tipoElemento === 'blocNotas') guardarPos(STATE.posBlocNotas);
                    else if (tipoElemento === 'botonModo') guardarPos(STATE.posBotonModo);
                    else if (tipoElemento === 'kb') guardarPos(STATE.posKB);
                };

                window.addEventListener('mousemove', mover);
                window.addEventListener('mouseup', detener);
            });

            elemento.addEventListener('mouseup', () => {
                if (tipoElemento === 'respuestas' && !STATE.posRespuestas.minimizado) {
                    STATE.posRespuestas.width = elemento.style.width;
                    STATE.posRespuestas.height = elemento.style.height;
                    localStorage.setItem('pos_respuestas_plata_v2', JSON.stringify(STATE.posRespuestas));
                } else if (tipoElemento === 'reloj') {
                    STATE.posReloj.width = elemento.style.width;
                    STATE.posReloj.height = elemento.style.height;
                    localStorage.setItem('pos_reloj_plata_v2', JSON.stringify(STATE.posReloj));
                    this.posicionarAccesoSuperior();
                } else if (tipoElemento === 'panel') {
                    STATE.posPanel.width = elemento.style.width;
                    STATE.posPanel.height = elemento.style.height;
                    localStorage.setItem('pos_panel_plata_v2', JSON.stringify(STATE.posPanel));
                } else if (tipoElemento === 'kb') {
                    if (!STATE.posKB.minimizado) {
                        STATE.posKB.width = elemento.style.width;
                        STATE.posKB.height = elemento.style.height;
                    }
                    localStorage.setItem('pos_herramientas_plata_v1', JSON.stringify(STATE.posKB));
                } else if (tipoElemento === 'blocNotas' && !STATE.posBlocNotas.minimizado) {
                    STATE.posBlocNotas.width = elemento.style.width;
                    STATE.posBlocNotas.height = elemento.style.height;
                    localStorage.setItem('pos_bloc_notas_plata_v1', JSON.stringify(STATE.posBlocNotas));
                }
            });
        },

        inicializarEstructuraFijaRespuestas() {
            if (!DOM.ventana) return;
            if (STATE.posRespuestas.minimizado) {
                DOM.ventana.innerHTML = `
                    <div data-suite-drag-handle="true" style="display: flex; justify-content: space-between; align-items: center; width: 100%; height: 100%;">
                        <span style="font-size:11px;font-weight:bold;color:var(--sd-acento);letter-spacing:.05em;">💬 SCRIPTS</span>
                        <button data-action="minimizar-respuestas" style="background:var(--sd-acento-suave);border:1px solid var(--sd-acento);color:var(--sd-acento-contraste);font-size:10px;font-weight:bold;padding:2px 8px;border-radius:6px;cursor:pointer;">Max</button>
                    </div>`;
                return;
            }

            const saludoVisual = UTILS.obtenerSaludoPorHora();
            const todasLasPlantillas = STATE.obtenerTodasLasPlantillas();

            const HTMLBotones = todasLasPlantillas.map((p, i) => {
                const tituloSeguro = UTILS.escaparHTML(p.titulo.replace("[SALUDO]", saludoVisual));
                const tagComando = p.comando ? ` <span style="opacity: 0.6; font-size: 9px; font-family: monospace;">(${UTILS.escaparHTML(p.comando)})</span>` : '';
                return `<button data-action="inyectar-plantilla" data-indice="${i}" class="btn-plantilla-premium">${tituloSeguro}${tagComando}</button>`;
            }).join('');

            DOM.ventana.innerHTML = `
                <div data-suite-drag-handle="true" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); padding-bottom: 8px; height: 32px; box-sizing: border-box;">
                    <div style="display: flex; flex-direction: column;">
                        <span id="texto-cliente-actual-respuestas" style="font-size:11px;font-weight:bold;color:var(--sd-acento);letter-spacing:.05em;">Cargando...</span>
                    </div>
                    <div style="display: flex; gap: 6px; align-items: center;">
                        <button data-action="abrir-editor-scripts" style="background:var(--sd-acento-suave);border:1px solid var(--sd-acento);color:var(--sd-acento-contraste);font-size:9px;font-weight:bold;padding:3px 7px;border-radius:6px;cursor:pointer;">✏️ Mis Scripts</button>
                        <button data-action="minimizar-respuestas" style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #cbd5e1; font-size: 9px; padding: 3px 8px; border-radius: 6px; cursor: pointer;">Min</button>
                    </div>
                </div>
                <div id="contenedor-scroll-respuestas" style="display: flex; flex-direction: column; gap: 1px; overflow-y: auto; height: calc(100% - 42px); box-sizing: border-box; padding-right: 4px;">
                    ${HTMLBotones}
                </div>
            `;
        },

        abrirModalEditorScripts() {
            let modal = document.getElementById("modal-editor-scripts-plata");
            if (modal) modal.remove();

            let indiceEdicionActual = null;
            let scriptsPendientesImportacion = [];

            modal = document.createElement('div');
            modal.id = "modal-editor-scripts-plata";
            modal.style = `
                position: fixed !important; top: 0 !important; left: 0 !important; width: 100vw !important; height: 100vh !important;
                background: rgba(0, 0, 0, 0.75) !important; backdrop-filter: blur(8px) !important;
                z-index: 999999999 !important; display: flex !important; align-items: center !important; justify-content: center !important;
                font-family: 'Inter', -apple-system, sans-serif !important;
            `;

            const generarListaPersonalizados = () => {
                if (STATE.scriptsPersonalizados.length === 0) {
                    return `<div style="color: #64748b; font-size: 12px; text-align: center; padding: 12px;">No tienes scripts configurados.</div>`;
                }
                return STATE.scriptsPersonalizados.map((item, index) => `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 8px 12px; margin-bottom: 6px;">
                        <div style="overflow: hidden; text-overflow: ellipsis; max-width: 65%;">
                            <div style="font-size: 11px; font-weight: bold; color: #34d399;">${UTILS.escaparHTML(item.titulo)} ${item.comando ? `<span style="color:#38bdf8; font-family:monospace;">(${UTILS.escaparHTML(item.comando)})</span>` : ''}</div>
                            <div style="font-size: 10px; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${UTILS.escaparHTML(item.texto)}</div>
                        </div>
                        <div style="display: flex; gap: 4px;">
                            <button data-action="editar-script-custom" data-index="${index}" style="background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; border-radius: 6px; padding: 4px 8px; font-size: 10px; cursor: pointer;">Editar</button>
                            <button data-action="eliminar-script-custom" data-index="${index}" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; border-radius: 6px; padding: 4px 8px; font-size: 10px; cursor: pointer;">Eliminar</button>
                        </div>
                    </div>
                `).join('');
            };

            const normalizarClaveImportacion = (valor) => String(valor || '')
                .trim()
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9]/g, '');

            const obtenerCampoImportado = (item, posiblesClaves) => {
                if (!item || typeof item !== 'object') return '';
                const campos = Object.entries(item).reduce((mapa, [clave, valor]) => {
                    mapa[normalizarClaveImportacion(clave)] = valor;
                    return mapa;
                }, {});
                for (const clave of posiblesClaves) {
                    const valor = campos[normalizarClaveImportacion(clave)];
                    if (valor !== undefined && valor !== null) return String(valor);
                }
                return '';
            };

            const normalizarScriptImportado = (item) => {
                const titulo = obtenerCampoImportado(item, ['titulo', 'título', 'title', 'nombre', 'name', 'label']).trim().slice(0, 180);
                let comando = obtenerCampoImportado(item, ['comando', 'command', 'shortcut', 'trigger', 'abreviatura', 'atajo']).trim().slice(0, 80);
                const texto = obtenerCampoImportado(item, ['texto', 'text', 'respuesta', 'response', 'contenido', 'content', 'snippet', 'body', 'mensaje']).trim().slice(0, 30000);

                if (!titulo || !texto) return null;
                if (comando && !comando.startsWith('/')) comando = '/' + comando;
                return { titulo, comando, texto };
            };

            const escaparCSV = (valor) => `"${String(valor ?? '').replace(/"/g, '""')}"`;

            const descargarArchivo = (nombre, contenido, tipo) => {
                const blob = new Blob([contenido], { type: tipo });
                const url = URL.createObjectURL(blob);
                const enlace = document.createElement('a');
                enlace.href = url;
                enlace.download = nombre;
                document.body.appendChild(enlace);
                enlace.click();
                enlace.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1500);
            };

            const nombreSeguroAgente = () => String(STATE.nombreAgente || 'agente')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9_-]+/g, '_')
                .replace(/^_+|_+$/g, '') || 'agente';

            const exportarScriptsCSV = () => {
                const filas = [
                    ['Título', 'Comando', 'Respuesta'],
                    ...STATE.scriptsPersonalizados.map(item => [item.titulo, item.comando || '', item.texto])
                ];
                const csv = '\uFEFF' + filas.map(fila => fila.map(escaparCSV).join(',')).join('\r\n');
                descargarArchivo(`scripts_${nombreSeguroAgente()}.csv`, csv, 'text/csv;charset=utf-8');
            };

            const exportarScriptsJSON = () => {
                const respaldo = {
                    formato: 'Sistema Dual Scripts',
                    version: 1,
                    exportadoEn: new Date().toISOString(),
                    agente: STATE.nombreAgente || '',
                    scripts: STATE.scriptsPersonalizados.map(item => ({
                        titulo: item.titulo,
                        comando: item.comando || '',
                        texto: item.texto
                    }))
                };
                descargarArchivo(
                    `scripts_${nombreSeguroAgente()}.json`,
                    JSON.stringify(respaldo, null, 2),
                    'application/json;charset=utf-8'
                );
            };

            const detectarSeparadorCSV = (texto) => {
                const primeraLinea = (texto.replace(/^\uFEFF/, '').split(/\r?\n/).find(linea => linea.trim()) || '');
                const candidatos = [',', ';', '\t'];
                let mejor = ',';
                let mayor = -1;
                for (const separador of candidatos) {
                    let cantidad = 0;
                    let entreComillas = false;
                    for (let i = 0; i < primeraLinea.length; i++) {
                        const caracter = primeraLinea[i];
                        if (caracter === '"') {
                            if (entreComillas && primeraLinea[i + 1] === '"') i++;
                            else entreComillas = !entreComillas;
                        } else if (!entreComillas && caracter === separador) {
                            cantidad++;
                        }
                    }
                    if (cantidad > mayor) {
                        mayor = cantidad;
                        mejor = separador;
                    }
                }
                return mejor;
            };

            const parsearCSV = (texto) => {
                const separador = detectarSeparadorCSV(texto);
                const filas = [];
                let fila = [];
                let campo = '';
                let entreComillas = false;
                const contenido = texto.replace(/^\uFEFF/, '');

                for (let i = 0; i < contenido.length; i++) {
                    const caracter = contenido[i];
                    if (caracter === '"') {
                        if (entreComillas && contenido[i + 1] === '"') {
                            campo += '"';
                            i++;
                        } else {
                            entreComillas = !entreComillas;
                        }
                    } else if (caracter === separador && !entreComillas) {
                        fila.push(campo);
                        campo = '';
                    } else if ((caracter === '\n' || caracter === '\r') && !entreComillas) {
                        if (caracter === '\r' && contenido[i + 1] === '\n') i++;
                        fila.push(campo);
                        if (fila.some(valor => String(valor).trim())) filas.push(fila);
                        fila = [];
                        campo = '';
                    } else {
                        campo += caracter;
                    }
                }

                if (campo.length || fila.length) {
                    fila.push(campo);
                    if (fila.some(valor => String(valor).trim())) filas.push(fila);
                }
                if (filas.length < 2) throw new Error('El CSV no contiene scripts para importar.');

                const encabezados = filas[0].map(normalizarClaveImportacion);
                const tieneTitulo = encabezados.some(c => ['titulo', 'title', 'nombre', 'name', 'label'].includes(c));
                const tieneTexto = encabezados.some(c => ['texto', 'text', 'respuesta', 'response', 'contenido', 'content', 'snippet', 'body', 'mensaje'].includes(c));
                if (!tieneTitulo || !tieneTexto) {
                    throw new Error('El CSV necesita columnas de Título y Respuesta/Texto.');
                }

                return filas.slice(1).map(valores => {
                    const item = {};
                    encabezados.forEach((encabezado, indice) => { item[encabezado] = valores[indice] ?? ''; });
                    return item;
                });
            };

            const leerScriptsImportados = async (archivo) => {
                if (!archivo) return [];
                if (archivo.size > 2 * 1024 * 1024) throw new Error('El archivo supera el límite de 2 MB.');
                const contenido = await archivo.text();
                let datos;

                if (archivo.name.toLowerCase().endsWith('.json') || contenido.trim().startsWith('{') || contenido.trim().startsWith('[')) {
                    const json = JSON.parse(contenido);
                    datos = Array.isArray(json) ? json : (json.scripts || json.items || json.data);
                    if (!Array.isArray(datos)) throw new Error('El JSON no contiene una lista de scripts válida.');
                } else {
                    datos = parsearCSV(contenido);
                }

                const normalizados = datos.map(normalizarScriptImportado).filter(Boolean).slice(0, 1000);
                if (!normalizados.length) throw new Error('No se encontraron scripts válidos con título y texto.');
                return normalizados;
            };

            const mostrarVistaPreviaImportacion = (scripts) => {
                const estado = document.getElementById('estado-importacion-scripts');
                const ejemplos = scripts.slice(0, 4).map(item => `
                    <div style="padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.06); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        <strong style="color:#e2e8f0;">${UTILS.escaparHTML(item.titulo)}</strong>
                        ${item.comando ? `<span style="color:#38bdf8; font-family:monospace;"> ${UTILS.escaparHTML(item.comando)}</span>` : ''}
                    </div>`).join('');
                estado.innerHTML = `
                    <div style="font-size:10px; color:#94a3b8; margin-bottom:5px;">Se encontraron <strong style="color:#34d399;">${scripts.length}</strong> scripts. Vista previa:</div>
                    ${ejemplos}
                    ${scripts.length > 4 ? `<div style="font-size:9px; color:#64748b; padding-top:4px;">y ${scripts.length - 4} más…</div>` : ''}
                    <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
                        <button data-action="confirmar-importacion-combinar" style="flex:1; min-width:120px; background:#0284c7; border:none; color:white; padding:7px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">Combinar / actualizar</button>
                        <button data-action="confirmar-importacion-reemplazar" style="flex:1; min-width:100px; background:rgba(245,158,11,.18); border:1px solid rgba(245,158,11,.45); color:#fbbf24; padding:7px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">Reemplazar todo</button>
                        <button data-action="cancelar-importacion-scripts" style="background:transparent; border:1px solid rgba(255,255,255,.15); color:#94a3b8; padding:7px 10px; border-radius:6px; font-size:10px; cursor:pointer;">Cancelar</button>
                    </div>`;
                estado.style.display = 'block';
            };

            const guardarImportacion = (modo) => {
                if (!scriptsPendientesImportacion.length) return;
                let resultado;

                if (modo === 'reemplazar') {
                    if (!confirm(`Se reemplazarán tus ${STATE.scriptsPersonalizados.length} scripts actuales por ${scriptsPendientesImportacion.length} scripts importados. ¿Deseas continuar?`)) return;
                    resultado = [...scriptsPendientesImportacion];
                } else {
                    resultado = STATE.scriptsPersonalizados.map(item => ({ ...item }));
                    const buscarCoincidencia = (item) => resultado.findIndex(actual => {
                        const comandoNuevo = String(item.comando || '').trim().toLowerCase();
                        const comandoActual = String(actual.comando || '').trim().toLowerCase();
                        if (comandoNuevo && comandoActual) return comandoNuevo === comandoActual;
                        return String(actual.titulo || '').trim().toLowerCase() === String(item.titulo || '').trim().toLowerCase();
                    });
                    scriptsPendientesImportacion.forEach(item => {
                        const indice = buscarCoincidencia(item);
                        if (indice >= 0) resultado[indice] = item;
                        else resultado.push(item);
                    });
                }

                STATE.guardarScriptsPersonalizados(resultado);
                UI_MANAGER.inicializarEstructuraFijaRespuestas();
                UI_MANAGER.refrescarSoloTextosRespuestas();
                resetearFormulario();
                document.getElementById('lista-scripts-personalizados').innerHTML = generarListaPersonalizados();

                const cantidad = scriptsPendientesImportacion.length;
                scriptsPendientesImportacion = [];
                const inputArchivo = document.getElementById('input-importar-scripts');
                if (inputArchivo) inputArchivo.value = '';
                const estado = document.getElementById('estado-importacion-scripts');
                estado.innerHTML = `<div style="color:#34d399; font-size:10px; font-weight:bold;">✓ ${cantidad} scripts importados correctamente.</div>`;
                estado.style.display = 'block';
            };

            modal.innerHTML = `
                <div class="suite-scroll-plata" style="background:var(--sd-panel-bg);border:1px solid var(--sd-borde);border-radius:16px;width:500px;max-width:92vw;max-height:92vh;overflow-y:auto;padding:20px;box-shadow:var(--sd-sombra);color:var(--sd-texto);box-sizing:border-box;">
                    <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; margin-bottom: 14px;">
                        <span style="font-weight:bold;font-size:13px;color:var(--sd-acento);">📝 GESTOR DE SCRIPTS Y COMANDOS</span>
                        <button id="cerrar-modal-scripts" style="background: transparent; border: none; color: #94a3b8; font-size: 14px; cursor: pointer;">✕</button>
                    </div>
                    <div style="margin-bottom: 14px; background: rgba(255,255,255,0.02); padding: 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.05);">
                        <span id="label-modo-script" style="font-size: 10px; color: #94a3b8; display: block; margin-bottom: 6px; font-weight: bold;">AGREGAR NUEVO SCRIPT</span>
                        <div style="display: flex; gap: 6px; margin-bottom: 8px;">
                            <input id="input-titulo-script" type="text" placeholder="Título (Ej: 🚀 Promoción)" style="flex-grow:2;background:var(--sd-campo);border:1px solid var(--sd-borde);color:var(--sd-texto);padding:8px;border-radius:6px;font-size:11px;box-sizing:border-box;" />
                            <input id="input-comando-script" type="text" placeholder="Comando (Ej: /C)" style="flex-grow:1;width:100px;background:var(--sd-campo);border:1px solid var(--sd-acento);color:var(--sd-acento-contraste);padding:8px;border-radius:6px;font-size:11px;font-weight:bold;box-sizing:border-box;" />
                        </div>
                        <textarea id="input-texto-script" placeholder="Texto del mensaje. Usa [SALUDO] para el saludo del día y XXX para el nombre del cliente." style="width:100%;height:60px;background:var(--sd-campo);border:1px solid var(--sd-borde);color:var(--sd-texto);padding:8px;border-radius:6px;font-size:11px;resize:none;margin-bottom:8px;box-sizing:border-box;"></textarea>
                        <div style="display: flex; gap: 6px;">
                            <button id="btn-guardar-nuevo-script" style="flex-grow:1;background:linear-gradient(145deg,var(--sd-acento2),var(--sd-acento));border:none;color:var(--sd-tinta-acento);padding:8px;border-radius:6px;font-size:11px;font-weight:bold;cursor:pointer;">+ Guardar Script</button>
                            <button id="btn-cancelar-edicion" style="display: none; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: #cbd5e1; padding: 8px 12px; border-radius: 6px; font-size: 11px; font-weight: bold; cursor: pointer;">Cancelar</button>
                        </div>
                    </div>
                    <div style="margin-bottom:14px; background:rgba(14,165,233,.06); border:1px solid rgba(56,189,248,.18); border-radius:10px; padding:10px;">
                        <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:7px;">
                            <div>
                                <div style="font-size:10px; color:#7dd3fc; font-weight:bold;">MOVER O RESPALDAR MIS SCRIPTS</div>
                                <div style="font-size:9px; color:#64748b; margin-top:2px;">CSV para otra herramienta · JSON para respaldo completo</div>
                            </div>
                        </div>
                        <div style="display:flex; gap:6px; flex-wrap:wrap;">
                            <button id="btn-exportar-scripts-csv" style="flex:1; min-width:100px; background:rgba(16,185,129,.15); border:1px solid rgba(16,185,129,.4); color:#34d399; padding:7px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">⬇ Exportar CSV</button>
                            <button id="btn-exportar-scripts-json" style="flex:1; min-width:100px; background:rgba(139,92,246,.15); border:1px solid rgba(139,92,246,.4); color:#c4b5fd; padding:7px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">⬇ Respaldo JSON</button>
                            <button id="btn-importar-scripts" style="flex:1; min-width:100px; background:rgba(56,189,248,.15); border:1px solid rgba(56,189,248,.4); color:#7dd3fc; padding:7px; border-radius:6px; font-size:10px; font-weight:bold; cursor:pointer;">⬆ Importar</button>
                            <input id="input-importar-scripts" type="file" accept=".csv,.json,text/csv,application/json" style="display:none;" />
                        </div>
                        <div id="estado-importacion-scripts" style="display:none; margin-top:8px; background:rgba(15,23,42,.75); border-radius:7px; padding:8px;"></div>
                    </div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 10px; color: #94a3b8; font-weight: bold;">MIS SCRIPTS CONFIGURADOS:</span>
                        <button id="btn-restaurar-predeterminados" style="background: transparent; border: none; color: #f59e0b; font-size: 9px; cursor: pointer; text-decoration: underline;">Restaurar por defecto</button>
                    </div>
                    <div id="lista-scripts-personalizados" style="max-height: 160px; overflow-y: auto; padding-right: 4px;">
                        ${generarListaPersonalizados()}
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const resetearFormulario = () => {
                indiceEdicionActual = null;
                document.getElementById('input-titulo-script').value = '';
                document.getElementById('input-comando-script').value = '';
                document.getElementById('input-texto-script').value = '';
                document.getElementById('label-modo-script').innerText = 'AGREGAR NUEVO SCRIPT';
                document.getElementById('label-modo-script').style.color = '#94a3b8';

                const btnGuardar = document.getElementById('btn-guardar-nuevo-script');
                btnGuardar.innerText = '+ Guardar Script';
                btnGuardar.style.background = 'linear-gradient(145deg,var(--sd-acento2),var(--sd-acento))';

                document.getElementById('btn-cancelar-edicion').style.display = 'none';
            };

            document.getElementById('cerrar-modal-scripts').onclick = () => modal.remove();
            document.getElementById('btn-cancelar-edicion').onclick = () => resetearFormulario();
            document.getElementById('btn-exportar-scripts-csv').onclick = () => {
                if (!STATE.scriptsPersonalizados.length) return alert('No hay scripts para exportar.');
                exportarScriptsCSV();
            };
            document.getElementById('btn-exportar-scripts-json').onclick = () => {
                if (!STATE.scriptsPersonalizados.length) return alert('No hay scripts para exportar.');
                exportarScriptsJSON();
            };
            document.getElementById('btn-importar-scripts').onclick = () => document.getElementById('input-importar-scripts').click();
            document.getElementById('input-importar-scripts').onchange = async (evento) => {
                const archivo = evento.target.files?.[0];
                if (!archivo) return;
                const estado = document.getElementById('estado-importacion-scripts');
                estado.style.display = 'block';
                estado.innerHTML = '<div style="color:#7dd3fc; font-size:10px;">Revisando archivo…</div>';
                try {
                    scriptsPendientesImportacion = await leerScriptsImportados(archivo);
                    mostrarVistaPreviaImportacion(scriptsPendientesImportacion);
                } catch (error) {
                    scriptsPendientesImportacion = [];
                    estado.innerHTML = `<div style="color:#fca5a5; font-size:10px; font-weight:bold;">No se pudo importar: ${UTILS.escaparHTML(error.message || 'archivo inválido')}</div>`;
                    evento.target.value = '';
                }
            };

            document.getElementById('btn-restaurar-predeterminados').onclick = () => {
                if (confirm("¿Seguro que deseas volver a cargar los scripts por defecto? Se perderán los cambios personalizados.")) {
                    STATE.guardarScriptsPersonalizados(CONFIG.PLANTILLAS_BASE);
                    UI_MANAGER.inicializarEstructuraFijaRespuestas();
                    UI_MANAGER.refrescarSoloTextosRespuestas();
                    resetearFormulario();
                    document.getElementById('lista-scripts-personalizados').innerHTML = generarListaPersonalizados();
                }
            };

            document.getElementById('btn-guardar-nuevo-script').onclick = () => {
                const titulo = document.getElementById('input-titulo-script').value.trim();
                let comando = document.getElementById('input-comando-script').value.trim();
                const texto = document.getElementById('input-texto-script').value.trim();

                if (!titulo || !texto) {
                    alert("Por favor completa al menos el título y el texto del script.");
                    return;
                }

                if (comando && !comando.startsWith('/')) {
                    comando = '/' + comando;
                }

                let listaActual = [...STATE.scriptsPersonalizados];

                if (indiceEdicionActual !== null) {
                    listaActual[indiceEdicionActual] = { titulo, comando, texto };
                } else {
                    listaActual.push({ titulo, comando, texto });
                }

                STATE.guardarScriptsPersonalizados(listaActual);
                UI_MANAGER.inicializarEstructuraFijaRespuestas();
                UI_MANAGER.refrescarSoloTextosRespuestas();

                resetearFormulario();
                document.getElementById('lista-scripts-personalizados').innerHTML = generarListaPersonalizados();
            };

            modal.addEventListener('click', (e) => {
                const btnEliminar = e.target.closest('[data-action="eliminar-script-custom"]');
                const btnEditar = e.target.closest('[data-action="editar-script-custom"]');
                const btnCombinar = e.target.closest('[data-action="confirmar-importacion-combinar"]');
                const btnReemplazar = e.target.closest('[data-action="confirmar-importacion-reemplazar"]');
                const btnCancelarImportacion = e.target.closest('[data-action="cancelar-importacion-scripts"]');

                if (btnCombinar) {
                    guardarImportacion('combinar');
                } else if (btnReemplazar) {
                    guardarImportacion('reemplazar');
                } else if (btnCancelarImportacion) {
                    scriptsPendientesImportacion = [];
                    const estado = document.getElementById('estado-importacion-scripts');
                    estado.innerHTML = '';
                    estado.style.display = 'none';
                    document.getElementById('input-importar-scripts').value = '';
                } else if (btnEliminar) {
                    const idx = parseInt(btnEliminar.getAttribute('data-index'), 10);
                    const listaActual = STATE.scriptsPersonalizados.filter((_, i) => i !== idx);
                    STATE.guardarScriptsPersonalizados(listaActual);
                    UI_MANAGER.inicializarEstructuraFijaRespuestas();
                    UI_MANAGER.refrescarSoloTextosRespuestas();
                    resetearFormulario();
                    document.getElementById('lista-scripts-personalizados').innerHTML = generarListaPersonalizados();
                } else if (btnEditar) {
                    const idx = parseInt(btnEditar.getAttribute('data-index'), 10);
                    const item = STATE.scriptsPersonalizados[idx];
                    if (!item) return;

                    indiceEdicionActual = idx;
                    document.getElementById('input-titulo-script').value = item.titulo;
                    document.getElementById('input-comando-script').value = item.comando || '';
                    document.getElementById('input-texto-script').value = item.texto;

                    document.getElementById('label-modo-script').innerText = 'EDITANDO SCRIPT EXISTENTE';
                    document.getElementById('label-modo-script').style.color = 'var(--sd-acento)';

                    const btnGuardar = document.getElementById('btn-guardar-nuevo-script');
                    btnGuardar.innerText = '💾 Actualizar Script';
                    btnGuardar.style.background = 'linear-gradient(145deg,var(--sd-acento2),var(--sd-acento))';

                    document.getElementById('btn-cancelar-edicion').style.display = 'block';
                }
            });
        },

        actualizarRelojSuperior() {
            if (!DOM.reloj) return;
            if (STATE.modoLlamadasActivo && !STATE.scriptsDuranteLlamada) {
                DOM.reloj.style.setProperty('display', 'none', 'important');
                return;
            }
            if (STATE.modoLlamadasActivo && !this.hayChatDisponibleParaScripts()) {
                DOM.reloj.style.setProperty('display', 'none', 'important');
                return;
            }
            const chat = STATE.memoriaChats[STATE.clienteActualKey];

            if (STATE.clienteActualKey && STATE.clienteActualEnPantalla && chat) {
                DOM.reloj.style.setProperty('display', 'block', 'important');

                const visual = INTERACCION_NORMAL.visualizar(chat);
                const colorTexto = visual.color;
                const colorBorde = visual.color;

                DOM.reloj.style.setProperty('border-color', colorBorde, 'important');
                DOM.reloj.title = `Cliente: ${STATE.clienteActualEnPantalla}`;

                if (STATE.ultimoClienteRenderizadoReloj !== STATE.clienteActualEnPantalla) {
                    STATE.ultimoClienteRenderizadoReloj = STATE.clienteActualEnPantalla;
                    DOM.reloj.classList.remove('animar-entrada-premium');
                    void DOM.reloj.offsetWidth;
                    DOM.reloj.classList.add('animar-entrada-premium');
                }

                const esUltraChico = DOM.reloj.offsetWidth < 190;
                const estructura = esUltraChico ? 'compacta' : 'completa';
                if (DOM.reloj.dataset.estructura !== estructura || !DOM.reloj.querySelector('.suite-reloj-tiempo')) {
                    DOM.reloj.dataset.estructura = estructura;
                    DOM.reloj.innerHTML = `
                        <div data-suite-drag-handle="true" style="display:flex;flex-direction:column;justify-content:center;gap:5px;height:100%;padding:6px 9px;box-sizing:border-box;">
                            <div class="suite-reloj-estado" style="font-size:${esUltraChico ? 9 : 11}px;font-weight:800;line-height:1.15;"></div>
                            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:6px;white-space:nowrap;">
                                <span class="suite-reloj-tiempo" style="font-size:${esUltraChico ? 15 : 18}px;font-weight:800;font-family:monospace;"></span>
                                <span class="suite-reloj-aht" style="font-size:${esUltraChico ? 9 : 11}px;color:#94a3b8;font-family:monospace;"></span>
                            </div>
                            <div class="suite-reloj-cliente" style="font-size:10px;color:#cbd5e1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"></div>
                        </div>`;
                }
                const estado = DOM.reloj.querySelector('.suite-reloj-estado');
                if (estado) { estado.textContent = visual.etiqueta; estado.style.color = visual.color; }
                const aht = DOM.reloj.querySelector('.suite-reloj-aht');
                if (aht) aht.textContent = `AHT ${UTILS.formatearTiempo(chat.aht)}`;
                const tiempo = DOM.reloj.querySelector('.suite-reloj-tiempo');
                if (tiempo) {
                    const valorTiempo = UTILS.formatearTiempo(chat.tiempo);
                    if (tiempo.textContent !== valorTiempo) tiempo.textContent = valorTiempo;
                    tiempo.style.color = colorTexto;
                }
                const cliente = DOM.reloj.querySelector('.suite-reloj-cliente');
                if (cliente && cliente.textContent !== (STATE.clienteActualEnPantalla || '')) cliente.textContent = STATE.clienteActualEnPantalla || '';
                if (visual.nivel === 2) DOM.reloj.classList.add('alerta-activa-plata');
                else DOM.reloj.classList.remove('alerta-activa-plata');
            } else {
                DOM.reloj.style.setProperty('display', 'none', 'important');
                STATE.ultimoClienteRenderizadoReloj = null;
            }
        },

        actualizarCronometrosEnRecuadrosCRM() {
            const pestañas = CRM_CACHE.pestanas();
            const ocurrencias = {};

            pestañas.forEach(pestaña => {
                const nombreCliente = UTILS.obtenerNombrePestanaChat(pestaña);
                const nombreLimpio = UTILS.pointerNormalizer(nombreCliente);

                if (!nombreLimpio || nombreLimpio.length <= 1) {
                    pestaña.querySelector('.suite-cronometro-chat-integrado')?.remove();
                    pestaña.classList.remove('suite-chat-con-cronometro');
                    return;
                }

                ocurrencias[nombreLimpio] = (ocurrencias[nombreLimpio] || 0) + 1;
                const claveChat = UTILS.obtenerClaveChat(pestaña, nombreLimpio, ocurrencias[nombreLimpio]);
                const chat = STATE.memoriaChats[claveChat];

                if (!chat || chat.finalizada) {
                    pestaña.querySelector('.suite-cronometro-chat-integrado')?.remove();
                    pestaña.classList.remove('suite-chat-con-cronometro');
                    return;
                }

                pestaña.classList.add('suite-chat-con-cronometro');
                let cronometro = pestaña.querySelector('.suite-cronometro-chat-integrado');
                if (!cronometro) {
                    cronometro = document.createElement('span');
                    cronometro.className = 'suite-cronometro-chat-integrado';
                    cronometro.setAttribute('aria-hidden', 'true');
                    pestaña.appendChild(cronometro);
                }

                const visual = INTERACCION_NORMAL.visualizar(chat);
                const estadoVisual = visual.clase;

                const claseCronometro = `suite-cronometro-chat-integrado ${estadoVisual}`.trim();
                if (cronometro.className !== claseCronometro) cronometro.className = claseCronometro;
                const tiempoFormateado = UTILS.formatearTiempo(chat.tiempo);
                const contenido = tiempoFormateado;
                if (cronometro.textContent !== contenido) cronometro.textContent = contenido;
                const tituloCronometro = `${nombreLimpio} · ${visual.etiqueta}: ${tiempoFormateado}`;
                if (cronometro.title !== tituloCronometro) cronometro.title = tituloCronometro;
                if (cronometro.dataset.chatKey !== claveChat) cronometro.dataset.chatKey = claveChat;
            });
        },

        actualizarPanelLateral() {
            if (!DOM.panel || STATE.modoLlamadasActivo) return;

            const pestañasDeChat = CRM_CACHE.pestanas();
            const ordenCRM = [];
            const conteoNombres = {};
            const ocurrenciasNombres = {};

            pestañasDeChat.forEach((pestaña) => {
                const nombreCliente = UTILS.obtenerNombrePestanaChat(pestaña);

                if (nombreCliente && nombreCliente.length > 1) {
                    const norm = UTILS.pointerNormalizer(nombreCliente);
                    conteoNombres[norm] = (conteoNombres[norm] || 0) + 1;
                    ocurrenciasNombres[norm] = (ocurrenciasNombres[norm] || 0) + 1;
                    const claveChat = UTILS.obtenerClaveChat(pestaña, norm, ocurrenciasNombres[norm]);
                    ordenCRM.push(claveChat);
                }
            });

            const keys = Object.keys(STATE.memoriaChats)
                .filter(clave => {
                    const chat = STATE.memoriaChats[clave];
                    return Boolean(chat && !chat.finalizada && !chat.ocultoTemporal);
                })
                .sort((a, b) => {
                const indexA = ordenCRM.indexOf(a);
                const indexB = ordenCRM.indexOf(b);

                if (indexA !== -1 && indexB !== -1) return indexA - indexB;
                if (indexA === -1) return 1;
                if (indexB === -1) return -1;

                    return 0;
                });

            const keysStr = keys
                .map(clave => `${clave}:${STATE.memoriaChats[clave]?.nombreCliente || ''}`)
                .join(',') + '_' + STATE.nombreAgente;

            const htmlFirmaFija = `
                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 6px; margin-top: auto; box-sizing: border-box; height: 18px;">
                    <button data-action="editar-apodo-agente" title="Editar tu nombre/apodo" style="background: transparent; border: none; color: rgba(255, 255, 255, 0.35); font-size: 9px; cursor: pointer; padding: 0; line-height: 1; transition: color 0.2s;">✏️</button>
                    <div style="font-size: 9px; color: rgba(16, 185, 129, 0.7); letter-spacing: 0.08em; text-transform: uppercase; font-weight: bold; pointer-events: none;">
                        by "Aldair Valdivia"
                    </div>
                </div>`;

            const tituloPanel = STATE.nombreAgente ? `PANEL DE ${STATE.nombreAgente.toUpperCase()}` : `CONTROL DE TIEMPOS`;
            const tituloPanelSeguro = UTILS.escaparHTML(tituloPanel);

            if (STATE._lastKeysStr !== keysStr) {
                STATE._lastKeysStr = keysStr;

                let htmlCabecera = `
                    <div data-suite-drag-handle="true" style="display:flex;justify-content:space-between;align-items:center;gap:7px;margin-bottom:12px;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:8px;min-height:28px;box-sizing:border-box;">
                        <span style="font-size:11px;font-weight:bold;color:#34d399;letter-spacing:.05em;pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;" title="${tituloPanelSeguro}">${tituloPanelSeguro}</span>
                        <span style="font-size:9px;color:#64748b;font-weight:bold;pointer-events:none;white-space:nowrap;">${keys.length} Activos</span>
                    </div>`;

                if (keys.length === 0) {
                    DOM.panel.innerHTML = `
                        <div style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
                            ${htmlCabecera}
                            <div style="text-align: center; color: #64748b; font-size: 11px; padding: 24px 10px; display: flex; flex-direction: column; gap: 8px; justify-content: center; align-items: center; flex-grow: 1; box-sizing: border-box;">
                                <div style="font-weight: 500;">No hay chats activos</div>
                            </div>
                            ${htmlFirmaFija}
                        </div>`;
                    return;
                }

                let htmlLista = '';
                const rastreoIndice = {};

                keys.forEach(claveChat => {
                    const chat = STATE.memoriaChats[claveChat];
                    if (!chat) return;
                    const nombre = chat.nombreCliente || claveChat.replace(/^nombre:/, '');

                    const visual = INTERACCION_NORMAL.visualizar(chat);
                    const colorTexto = visual.color;

                    const esActivo = (STATE.clienteActualKey === claveChat);
                    let borderColor = 'rgba(255, 255, 255, 0.08)';
                    if (esActivo) {
                        borderColor = INTERACCION_NORMAL.visualizar(chat).color;
                    }

                    let etiquetaVisual = nombre;
                    if ((conteoNombres[nombre] || 0) > 1) {
                        rastreoIndice[nombre] = (rastreoIndice[nombre] || 0) + 1;
                        etiquetaVisual = `${nombre} (chat ${rastreoIndice[nombre]})`;
                    }
                    const etiquetaSegura = UTILS.escaparHTML(etiquetaVisual);
                    const claveChatSegura = UTILS.escaparHTML(claveChat);

                    htmlLista += `
                        <div class="tarjeta-chat-premium" data-action="ir-chat" data-chat-key="${claveChatSegura}" style="border: 1px solid ${borderColor} !important; padding: 10px 12px !important; border-radius: 12px !important; margin-bottom: 8px !important; position: relative !important;">
                            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; pointer-events: none;">
                                <span style="font-size: 12px; font-weight: 600; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px;" title="${etiquetaSegura}">
                                    ${etiquetaSegura}
                                </span>
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="tiempo-cronometro" style="font-family: monospace; font-size: 12px; font-weight: bold; color: ${colorTexto};">
                                        ${UTILS.formatearTiempo(chat.tiempo)}
                                    </span>
                                    <button data-action="borrar-cronometro" data-chat-key="${claveChatSegura}" style="pointer-events: auto; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; border-radius: 6px; width: 20px; height: 20px; font-size: 10px; cursor: pointer; display: flex; align-items: center; justify-content: center;">✕</button>
                                </div>
                            </div>
                            <div class="detalle-cronometro" style="display: flex; flex-wrap: wrap; gap: 3px 8px; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; margin-top: 2px; pointer-events: none;">
                                <span class="modo-cronometro">${INTERACCION_NORMAL.visualizar(chat).etiqueta}</span>
                                <span class="aht-cronometro">AHT: ${UTILS.formatearTiempo(chat.aht)}</span>
                            </div>
                        </div>`;
                });

                DOM.panel.innerHTML = `
                    <div style="display: flex; flex-direction: column; height: 100%; box-sizing: border-box;">
                        ${htmlCabecera}
                        <div id="contenedor-lista-chats-scroll" style="display: block; overflow-y: auto; flex-grow: 1; box-sizing: border-box; padding-right: 4px; margin-bottom: 6px;">
                            ${htmlLista}
                        </div>
                        ${htmlFirmaFija}
                    </div>`;
            } else {
                const tarjetasPorClave = new Map(
                    Array.from(DOM.panel.querySelectorAll('.tarjeta-chat-premium[data-chat-key]'))
                        .map(tarjeta => [tarjeta.getAttribute('data-chat-key'), tarjeta])
                );
                keys.forEach(claveChat => {
                    const chat = STATE.memoriaChats[claveChat];
                    if (!chat) return;

                    const tarjeta = tarjetasPorClave.get(claveChat);
                    if (tarjeta) {
                        const elTiempo = tarjeta.querySelector('.tiempo-cronometro');
                        if (elTiempo) {
                            const tiempoFormateado = UTILS.formatearTiempo(chat.tiempo);
                            if (elTiempo.textContent !== tiempoFormateado) elTiempo.textContent = tiempoFormateado;

                            const visual = INTERACCION_NORMAL.visualizar(chat);
                            const colorTexto = visual.color;

                            if (elTiempo.dataset.color !== colorTexto) {
                                elTiempo.dataset.color = colorTexto;
                                elTiempo.style.setProperty('color', colorTexto, 'important');
                            }
                        }

                        const esActivo = (STATE.clienteActualKey === claveChat);
                        let borderColor = 'rgba(255, 255, 255, 0.08)';
                        if (esActivo) {
                            borderColor = INTERACCION_NORMAL.visualizar(chat).color;
                        }
                        if (tarjeta.dataset.colorBorde !== borderColor) {
                            tarjeta.dataset.colorBorde = borderColor;
                            tarjeta.style.setProperty('border-color', borderColor, 'important');
                        }

                        const elDetalle = tarjeta.querySelector('.detalle-cronometro');
                        if (elDetalle) {
                            const modo = tarjeta.querySelector('.modo-cronometro');
                            const aht = tarjeta.querySelector('.aht-cronometro');
                            const textoModo = `${INTERACCION_NORMAL.visualizar(chat).etiqueta}`;
                            const textoAHT = `AHT: ${UTILS.formatearTiempo(chat.aht)}`;
                            if (modo && modo.textContent !== textoModo) modo.textContent = textoModo;
                            if (aht && aht.textContent !== textoAHT) aht.textContent = textoAHT;
                        }
                    }
                });
            }
        },

        refrescarSoloTextosRespuestas() {
            if (STATE.posRespuestas.minimizado || !DOM.ventana) return;
            const elTexto = document.getElementById('texto-cliente-actual-respuestas');
            const elContenedor = document.getElementById('contenedor-scroll-respuestas');
            if (!elContenedor) return;

            const activo = Boolean(STATE.clienteActualEnPantalla);
            const firma = `${activo ? '1' : '0'}|${STATE.clienteActualEnPantalla || ''}`;
            if (elContenedor.dataset.estadoDinamico === firma) return;
            elContenedor.dataset.estadoDinamico = firma;

            if (activo) {
                if (elTexto) elTexto.innerText = `${STATE.clienteActualEnPantalla.toUpperCase()}`;
                elContenedor.style.opacity = "1";
                elContenedor.style.pointerEvents = "auto";
                elContenedor.querySelectorAll('.btn-plantilla-premium').forEach(btn => btn.removeAttribute('disabled'));
            } else {
                if (elTexto) elTexto.innerText = "SISTEMA INACTIVO";
                elContenedor.style.opacity = "0.4";
                elContenedor.style.pointerEvents = "none";
                elContenedor.querySelectorAll('.btn-plantilla-premium').forEach(btn => btn.setAttribute('disabled', 'true'));
            }
        },

        inyectarRespuestaRapida(indice, btnElement = null) {
            if (!STATE.clienteActualEnPantalla) return;
            const todasLasPlantillas = STATE.obtenerTodasLasPlantillas();
            const plantilla = todasLasPlantillas[indice];
            if (!plantilla) return;

            const mensajeFinal = UTILS.procesarTextoScript(plantilla.texto, STATE.clienteActualEnPantalla);
            const campoActual = this.obtenerCampoChatEditable();
            if (!campoActual) {
                this.mostrarToast('Abre un chat con el campo de respuesta habilitado');
                return;
            }

            // El CRM administra el textarea con React. Se usa el setter nativo
            // para que el contenido visual y el estado interno permanezcan iguales.
            DOM.inputArea = campoActual;
            const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
            if (descriptor?.set) descriptor.set.call(campoActual, mensajeFinal);
            else campoActual.value = mensajeFinal;
            campoActual.focus();
            try {
                campoActual.dispatchEvent(new InputEvent('input', {
                    bubbles: true,
                    inputType: 'insertText',
                    data: mensajeFinal
                }));
            } catch (_) {
                campoActual.dispatchEvent(new Event('input', { bubbles: true }));
            }
            campoActual.dispatchEvent(new Event('change', { bubbles: true }));
            campoActual.setSelectionRange?.(mensajeFinal.length, mensajeFinal.length);

            UTILS.animarEfectoPinata(btnElement || campoActual);
        },

        enlazarDetectorComandos() {
            document.addEventListener('input', (e) => {
                const target = e.target;
                if (!UTILS.esTextareaChat(target)) return;

                const val = target.value;
                if (!val || !val.includes('/')) return;

                const todasLasPlantillas = STATE.obtenerTodasLasPlantillas();

                for (let p of todasLasPlantillas) {
                    if (p.comando && p.comando.trim().length > 1) {
                        const cmd = p.comando.trim();
                        const comandoSeguro = UTILS.escaparRegex(cmd);
                        const regex = new RegExp(`(?:^|\\s)${comandoSeguro}(?:\\s|$)`, 'i');

                        if (regex.test(val)) {
                            const mensajeFinal = UTILS.procesarTextoScript(p.texto, STATE.clienteActualEnPantalla);
                            target.value = val.replace(new RegExp(`${comandoSeguro}(?:\\s|$)`, 'i'), mensajeFinal + ' ');
                            target.dispatchEvent(new Event('input', { bubbles: true }));
                            target.dispatchEvent(new Event('change', { bubbles: true }));

                            UTILS.animarEfectoPinata(target);
                            break;
                        }
                    }
                }
            }, true);
        },

        enlazarEventosGlobales() {
            // Manejador centralizado para actualizaciones dinámicas de llamadas sin alterar la renderización para prevenir pérdida de foco
            const guardarNotasDebounced = UTILS.debounce(() => {
                STATE.guardarLlamadasDisco();
            }, 300);
            const guardarNotaHistorialDebounced = UTILS.debounce((id, notas) => {
                STATE.actualizarRegistroHistorial(id, { notas });
            }, 350);
            const selectorScrollSuite = '.suite-scroll-plata,.suite-paleta-lista,#scroll-llamadas,#contenedor-scroll-respuestas,#lista-scripts-personalizados,#contenedor-lista-chats-scroll';
            const obtenerAreaScroll = target => target?.closest?.(selectorScrollSuite);
            const animacionesScroll = new WeakMap();

            const detenerScrollSuave = area => {
                const estado = animacionesScroll.get(area);
                if (estado?.raf) cancelAnimationFrame(estado.raf);
                animacionesScroll.delete(area);
            };

            const desplazarSuave = (area, distancia) => {
                const maximo = Math.max(0, area.scrollHeight - area.clientHeight);
                let estado = animacionesScroll.get(area);
                if (!estado) {
                    estado = { destino: area.scrollTop, raf: 0 };
                    animacionesScroll.set(area, estado);
                }
                estado.destino = Math.max(0, Math.min(maximo, estado.destino + distancia));
                if (estado.raf) return;

                const animar = () => {
                    const diferencia = estado.destino - area.scrollTop;
                    if (Math.abs(diferencia) <= .45) {
                        area.scrollTop = estado.destino;
                        estado.raf = 0;
                        return;
                    }
                    area.scrollTop += diferencia * .2;
                    estado.raf = requestAnimationFrame(animar);
                };
                estado.raf = requestAnimationFrame(animar);
            };

            document.addEventListener('wheel', (e) => {
                const area = obtenerAreaScroll(e.target);
                if (!area || area.scrollHeight <= area.clientHeight) return;
                STATE.scrollSuiteActivoHasta = Date.now() + 1200;
                const factor = e.deltaMode === WheelEvent.DOM_DELTA_LINE
                    ? 18
                    : (e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? Math.max(1, area.clientHeight * .85) : 1);
                const desplazamiento = e.deltaY * factor;
                if (!desplazamiento) return;
                // Acumula los impulsos de rueda o trackpad en un mismo destino.
                // requestAnimationFrame suaviza el recorrido sin cederlo al CRM.
                desplazarSuave(area, desplazamiento);
                e.preventDefault();
                e.stopImmediatePropagation();
            }, { capture: true, passive: false });

            document.addEventListener('scroll', (e) => {
                if (obtenerAreaScroll(e.target)) STATE.scrollSuiteActivoHasta = Date.now() + 900;
            }, true);

            document.addEventListener('pointerdown', (e) => {
                const area = obtenerAreaScroll(e.target);
                if (area) {
                    detenerScrollSuave(area);
                    STATE.scrollSuiteActivoHasta = Date.now() + 900;
                }
            }, true);

            document.addEventListener('keydown', (e) => {
                if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
                    e.preventDefault();
                    if (STATE.inicioSincronizando) {
                        this.mostrarToast('Sincronizando tu sesión…');
                        return;
                    }
                    this.abrirPaletaComandos('');
                } else if (e.key === 'Escape' && document.getElementById('suite-paleta-comandos')) {
                    this.cerrarPaletaComandos();
                }
            });

            document.body.addEventListener('input', (e) => {
                if (STATE.inicioSincronizando) return;
                if (e.target.id === 'suite-paleta-input') {
                    this.renderizarPaletaComandos(e.target.value, true);
                    return;
                }
                if (e.target.id === 'suite-historial-busqueda') {
                    STATE.historialBusqueda = e.target.value;
                    this.actualizarListaHistorial(false);
                    return;
                }
                const notaHistorial = e.target.closest('[data-action="historial-actualizar-notas"]');
                if (notaHistorial) {
                    const id = notaHistorial.getAttribute('data-id');
                    const registro = STATE.historial7Dias.find(item => String(item.interaccionId || '') === String(id || ''));
                    if (registro) registro.notas = notaHistorial.value;
                    guardarNotaHistorialDebounced(id, notaHistorial.value);
                    return;
                }
                const idLlamadaTarget = e.target.closest('[data-action="actualizar-id-llamada"]');
                const notasTarget = e.target.closest('[data-action="actualizar-notas-llamada"]');

                if (idLlamadaTarget) {
                    const idItem = idLlamadaTarget.getAttribute('data-id');
                    const item = STATE.registroLlamadas.find(x => x.id === idItem);
                    if (item) {
                        item.idLlamada = idLlamadaTarget.value;
                        STATE.sincronizarLlamadaConHistorial(item);
                        guardarNotasDebounced();
                    }
                } else if (notasTarget) {
                    const idItem = notasTarget.getAttribute('data-id');
                    const item = STATE.registroLlamadas.find(x => x.id === idItem);
                    if (item) {
                        item.notas = notasTarget.value;
                        STATE.sincronizarLlamadaConHistorial(item);
                        guardarNotasDebounced();
                    }
                }
            });

            document.body.addEventListener('change', (e) => {
                if (STATE.inicioSincronizando) return;
                if (e.target.id === 'suite-historial-fecha') {
                    STATE.historialFiltroFecha = e.target.value;
                    this.actualizarListaHistorial(false);
                    return;
                }
                if (e.target.id === 'suite-historial-tipo') {
                    STATE.historialFiltroTipo = e.target.value;
                    this.actualizarListaHistorial(false);
                    return;
                }
                if (e.target.id === 'suite-historial-estado') {
                    STATE.historialFiltroEstado = e.target.value;
                    this.actualizarListaHistorial(false);
                    return;
                }
                const resultadoHistorial = e.target.closest('[data-action="historial-cambiar-resultado"]');
                if (resultadoHistorial) {
                    const valor = resultadoHistorial.value === 'SIN_DEFINIR' ? '' : resultadoHistorial.value;
                    STATE.actualizarRegistroHistorial(resultadoHistorial.getAttribute('data-id'), { resultado: valor });
                    this.actualizarListaHistorial(true);
                    return;
                }
                const estadoHistorial = e.target.closest('[data-action="historial-cambiar-estado"]');
                if (estadoHistorial) {
                    STATE.actualizarRegistroHistorial(estadoHistorial.getAttribute('data-id'), { estadoGestion: estadoHistorial.value });
                    this.actualizarListaHistorial(true);
                    return;
                }
                const estadoTarget = e.target.closest('[data-action="cambiar-estado-llamada"]');
                if (estadoTarget) {
                    const idItem = estadoTarget.getAttribute('data-id');
                    const item = STATE.registroLlamadas.find(x => x.id === idItem);
                    if (item) {
                        item.estado = estadoTarget.value;
                        STATE.sincronizarLlamadaConHistorial(item);
                        STATE.guardarLlamadasDisco();
                        this.renderizarContenidoBlocNotas();
                    }
                }
            });

            document.body.addEventListener('click', async (e) => {
                let target;
                const accionDuranteInicio = e.target.closest?.('[data-action]')?.getAttribute('data-action') || '';
                if (STATE.inicioSincronizando && accionDuranteInicio && !['kb-minimizar', 'kb-restaurar'].includes(accionDuranteInicio)) {
                    e.preventDefault();
                    this.mostrarToast('Sincronizando tu sesión…');
                    return;
                }
                if ((target = e.target.closest('[data-action="herramientas-vista"]'))) {
                    const vista = target.getAttribute('data-vista');
                    STATE.posKB.vista = ['inicio','ultimos','tema','acerca'].includes(vista) ? vista : 'inicio';
                    localStorage.setItem('pos_herramientas_plata_v1', JSON.stringify(STATE.posKB));
                    this.renderizarKB();
                } else if (e.target.closest('[data-action="alternar-historial-7d"]')) {
                    STATE.mostrarHistorial7Dias = !STATE.mostrarHistorial7Dias;
                    await STATE.refrescarHistorialLocal();
                    this.renderizarUltimosHerramientas();
                } else if (e.target.closest('[data-action="finalizar-turno"]')) {
                    if (window.confirm('¿Finalizar el turno actual? El siguiente chat o llamada iniciará un turno nuevo.')) STATE.finalizarTurnoManual();
                } else if (e.target.closest('[data-action="ver-llamadas-pendientes"]')) {
                    this.mostrarLlamadasPendientes();
                } else if (e.target.closest('[data-action="cerrar-pendientes"]') || e.target.id === 'suite-llamadas-pendientes') {
                    document.getElementById('suite-llamadas-pendientes')?.remove();
                } else if ((target = e.target.closest('[data-action="pendiente-copiar-id"]'))) {
                    const item = STATE.registroLlamadas.find(x => x.id === target.getAttribute('data-id'));
                    if (item?.idLlamada) await this.copiarTextoEmergencia(item.idLlamada);
                } else if ((target = e.target.closest('[data-action="pendiente-marcar-justificada"]'))) {
                    const item = STATE.registroLlamadas.find(x => x.id === target.getAttribute('data-id'));
                    if (item) { item.estado = 'JUSTIFICADO'; STATE.sincronizarLlamadaConHistorial(item); STATE.guardarLlamadasDisco(); this.mostrarLlamadasPendientes(); }
                } else if (e.target.closest('[data-action="pendiente-abrir-modulo"]')) {
                    document.getElementById('suite-llamadas-pendientes')?.remove();
                    STATE.filtroEstadoLlamadas = 'SIN_JUSTIFICAR';
                    this.establecerModoLlamadas(true, false);
                } else if (e.target.closest('[data-action="suite-abrir-paleta"]')) {
                    this.abrirPaletaComandos('');
                } else if (e.target.closest('[data-action="suite-cerrar-paleta"]') || e.target.id === 'suite-paleta-comandos') {
                    this.cerrarPaletaComandos();
                } else if (e.target.closest('[data-action="suite-alternar-vista-operativa"]')) {
                    this.alternarVistaOperativa();
                } else if (e.target.closest('[data-action="suite-cerrar-sesion"]')) {
                    if (window.confirm('¿Deseas cerrar tu sesión de Sistema Dual? Tus cambios se guardarán antes de salir.')) {
                        await AUTH_MANAGER.cerrarSesion();
                    }
                } else if ((target = e.target.closest('[data-action="suite-resultado-paleta"]'))) {
                    const item = STATE.resultadosPaletaSuite[parseInt(target.getAttribute('data-indice'), 10)];
                    await this.ejecutarResultadoSuite(item);
                } else if (e.target.closest('[data-action="restablecer-posiciones-paneles"]')) {
                    if (window.confirm('¿Devolver todas las ventanas flotantes a sus posiciones visibles predeterminadas?')) {
                        this.restablecerPosicionesPaneles();
                    }
                } else if (e.target.closest('[data-action="noticia-editar"]')) {
                    NUBE_COMPARTIDA.abrirEditorNoticia();
                } else if (e.target.closest('[data-action="noticia-guardar"]')) {
                    await NUBE_COMPARTIDA.guardarNoticiaDesdeEditor();
                } else if (e.target.closest('[data-action="noticia-alternar"]')) {
                    try {
                        await NUBE_COMPARTIDA.alternarNoticia();
                    } catch (error) {
                        this.mostrarToast('No se pudo cambiar el estado de la noticia');
                    }
                } else if (e.target.closest('[data-action="noticia-cerrar"]') || e.target.id === 'suite-noticia-editor') {
                    document.getElementById('suite-noticia-editor')?.remove();
                } else if (e.target.closest('[data-action="actualizar-suite"]')) {
                    await ACTUALIZADOR_SUITE.abrirActualizacion();
                } else if (e.target.closest('[data-action="interaccion-normal"]')) {
                    this.abrirInteraccionNormal();
                } else if (e.target.closest('[data-action="alternar-panel-cronometros"]')) {
                    this.alternarPanelCronometros();
                } else if ((target = e.target.closest('[data-action="cambiar-estilo"]'))) {
                    const rect = target.getBoundingClientRect();
                    const origenX = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : rect.left + rect.width / 2;
                    const origenY = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : rect.top + rect.height / 2;
                    this.cambiarTemaAnimado(STATE.tema, origenX, origenY, target.getAttribute('data-estilo'));
                } else if ((target = e.target.closest('[data-action="cambiar-tema"]'))) {
                    const rect = target.getBoundingClientRect();
                    const origenX = Number.isFinite(e.clientX) && e.clientX > 0 ? e.clientX : rect.left + rect.width / 2;
                    const origenY = Number.isFinite(e.clientY) && e.clientY > 0 ? e.clientY : rect.top + rect.height / 2;
                    this.cambiarTemaAnimado(target.getAttribute('data-tema'), origenX, origenY);
                } else if ((target = e.target.closest('[data-action="herramientas-copiar-id"]'))) {
                    const item = STATE.historialEmergencia.find(registro => registro.taskId === (target.getAttribute('data-task-id') || ''));
                    if (item?.uidCliente) await this.copiarTextoEmergencia(item.uidCliente);
                } else if (e.target.closest('[data-action="kb-minimizar"]')) {
                    STATE.posKB.minimizado=true; localStorage.setItem('pos_herramientas_plata_v1',JSON.stringify(STATE.posKB)); this.renderizarKB();
                } else if (e.target.closest('[data-action="kb-restaurar"]')) {
                    STATE.posKB.minimizado=false; localStorage.setItem('pos_herramientas_plata_v1',JSON.stringify(STATE.posKB)); this.renderizarKB();
                } else if ((target = e.target.closest('[data-action="editar-nombre-cliente-llamada"]'))) {
                    e.stopPropagation();
                    const idItem = target.getAttribute('data-id');
                    const item = STATE.registroLlamadas.find(x => x.id === idItem);
                    if (item) {
                        const nuevoNombre = prompt("Modifica el nombre del cliente:", item.cliente);
                        if (nuevoNombre !== null && nuevoNombre.trim() !== "") {
                            item.cliente = nuevoNombre.trim();
                            STATE.guardarLlamadasDisco();
                            this.renderizarContenidoBlocNotas();
                        }
                    }
                } else if ((target = e.target.closest('[data-action="eliminar-llamada-individual"]'))) {
                    e.stopPropagation();
                    const idItem = target.getAttribute('data-id');
                    if (confirm("¿Deseas eliminar este registro de llamada permanentemente?")) {
                        STATE.registroLlamadas = STATE.registroLlamadas.filter(x => x.id !== idItem);
                        STATE.guardarLlamadasDisco();
                        this.renderizarContenidoBlocNotas();
                    }
                } else if ((target = e.target.closest('[data-action="borrar-cronometro"]'))) {
                    e.stopPropagation();
                    const claveChat = target.getAttribute('data-chat-key');
                    STATE.finalizarInteraccion(claveChat, 'RETIRADA_MANUAL');
                    delete STATE.memoriaChats[claveChat];
                    STATE.eliminadosVoluntariamente.add(claveChat);
                    if (STATE.clienteActualKey === claveChat) {
                        STATE.clienteActualKey = null;
                        STATE.clienteActualEnPantalla = null;
                    }
                    STATE.guardarEnDisco();
                } else if ((target = e.target.closest('[data-action="ir-chat"]'))) {
                    const claveChat = target.getAttribute('data-chat-key');
                    const chat = STATE.memoriaChats[claveChat];
                    const tabs = CRM_CACHE.pestanas();
                    const ocurrencias = {};
                    for (let p of tabs) {
                        const textoDiv = p.querySelector('.text-nowrap, .text-ellipsis') || p;
                        const nombrePestana = UTILS.pointerNormalizer(
                            UTILS.textToClean(textoDiv ? textoDiv.innerText.trim() : p.innerText.trim())
                        );
                        ocurrencias[nombrePestana] = (ocurrencias[nombrePestana] || 0) + 1;
                        const clavePestana = UTILS.obtenerClaveChat(p, nombrePestana, ocurrencias[nombrePestana]);
                        if (clavePestana === claveChat) {
                            p.click();
                            break;
                        }
                    }
                } else if (e.target.closest('[data-action="abrir-emergencia"]')) {
                    e.stopPropagation();
                    STATE.posKB.vista = 'ultimos';
                    STATE.posKB.minimizado = false;
                    localStorage.setItem('pos_herramientas_plata_v1', JSON.stringify(STATE.posKB));
                    this.renderizarKB();
                } else if (e.target.closest('[data-action="minimizar-respuestas"]')) {
                    STATE.posRespuestas.minimizado = !STATE.posRespuestas.minimizado;
                    STATE.posRespuestas.top = DOM.ventana.style.top;
                    STATE.posRespuestas.left = DOM.ventana.style.left;
                    localStorage.setItem('pos_respuestas_plata_v2', JSON.stringify(STATE.posRespuestas));
                    this.aplicarDimensionesRespuestas();
                    this.inicializarEstructuraFijaRespuestas();
                } else if (e.target.closest('[data-action="minimizar-bloc-notas"]')) {
                    STATE.posBlocNotas.minimizado = !STATE.posBlocNotas.minimizado;
                    STATE.posBlocNotas.top = DOM.blocNotas.style.top;
                    STATE.posBlocNotas.left = DOM.blocNotas.style.left;
                    localStorage.setItem('pos_bloc_notas_plata_v1', JSON.stringify(STATE.posBlocNotas));
                    this.aplicarDimensionesBlocNotas();
                    this.renderizarContenidoBlocNotas();
                } else if (e.target.closest('[data-action="abrir-editor-scripts"]')) {
                    this.abrirModalEditorScripts();
                } else if ((target = e.target.closest('[data-action="inyectar-plantilla"]')) && !target.hasAttribute('disabled')) {
                    this.inyectarRespuestaRapida(parseInt(target.getAttribute('data-indice'), 10), target);
                } else if (e.target.closest('[data-action="editar-apodo-agente"]')) {
                    const nuevo = prompt("Modifica tu Nombre y Apellido:", STATE.nombreAgente);
                    if (nuevo !== null && nuevo.trim() !== "") {
                        await STATE.guardarNombreAgente(nuevo.trim());
                    }
                }
            });
        }
    };

    // =========================================================================
    // COLA ÚNICA DE ACTUALIZACIONES VISUALES
    // =========================================================================
    const COLA_VISUAL = {
        pendientes: new Set(),
        cuadro: 0,

        solicitar(...tareas) {
            const cantidadAntes = this.pendientes.size;
            tareas.filter(Boolean).forEach(tarea => this.pendientes.add(tarea));
            RENDIMIENTO.solicitudesVisuales += tareas.length;
            if (this.cuadro) {
                RENDIMIENTO.actualizacionesAgrupadas += Math.max(1, tareas.length - (this.pendientes.size - cantidadAntes));
                return;
            }
            this.cuadro = requestAnimationFrame(() => this.ejecutar());
        },

        ejecutar() {
            this.cuadro = 0;
            const tareas = Array.from(this.pendientes);
            this.pendientes.clear();
            RENDIMIENTO.cuadrosVisuales += 1;
            const ejecutar = (nombre, operacion) => {
                if (tareas.includes(nombre)) RENDIMIENTO.medir(nombre, operacion);
            };
            ejecutar('reloj', () => UI_MANAGER.actualizarRelojSuperior());
            ejecutar('panel', () => UI_MANAGER.actualizarPanelLateral());
            ejecutar('pestanas', () => UI_MANAGER.actualizarCronometrosEnRecuadrosCRM());
            ejecutar('respuestas', () => UI_MANAGER.refrescarSoloTextosRespuestas());
            ejecutar('inicio', () => UI_MANAGER.actualizarResumenInicio());
            ejecutar('historial', () => {
                if (STATE.posKB.vista === 'ultimos' && !STATE.posKB.minimizado) UI_MANAGER.actualizarDuracionesHistorialVisible();
            });
            ejecutar('rendimiento', () => RENDIMIENTO.actualizarVista());
        }
    };

    // =========================================================================
    // CRONÓMETROS ASCENDENTES: AHT total y tiempo de la fase actual.
    // Las fechas persistidas evitan reinicios por cambio de chat o recarga.
    // =========================================================================
    const MOTOR_CRONOMETROS_V2 = {
        estadisticas: { ticks:0, pausasRecuperadas:0, ultimoTick:0 },

        registrarFase(chat, _duracionLegada, fase) {
            if (!chat) return;
            const ahora = Date.now();
            chat.tipo = fase || chat.tipo || 'seguimiento';
            chat.motorV2 = { version:3, fase:chat.tipo, inicioMs:ahora, nivelAvisado:0 };
            chat.tiempo = 0;
            chat.sonadoVencido = false;
        },

        recuperar(chat, ahora = Date.now()) {
            const meta = chat.motorV2;
            if (meta?.version === 3 && Number.isFinite(meta.inicioMs) && meta.fase === chat.tipo) return;
            // Convierte una cuenta regresiva guardada sin reiniciar el AHT.
            const fase = chat.tipo === 'vencido' ? 'seguimiento' : (chat.tipo || 'bienvenida');
            const inicioLegado = meta?.fase !== 'vencido' && Number.isFinite(meta?.limiteMs) && Number.isFinite(meta?.duracionInicial)
                ? meta.limiteMs - meta.duracionInicial * 1000
                : Number.isFinite(meta?.actualizadoEn) ? meta.actualizadoEn
                : fase === 'bienvenida' && Number.isFinite(chat.inicioAHT) ? chat.inicioAHT : ahora;
            chat.tipo = fase;
            chat.motorV2 = { version:3, fase, inicioMs:Math.min(ahora, inicioLegado), nivelAvisado:0 };
            chat.tiempo = Math.max(0, Math.floor((ahora - chat.motorV2.inicioMs) / 1000));
            // No reproduce alertas antiguas al migrar por primera vez.
            chat.motorV2.nivelAvisado = INTERACCION_NORMAL.visualizar(chat).nivel;
        },

        adoptarEstadoActual() {
            const ahora = Date.now();
            Object.values(STATE.memoriaChats || {}).forEach(chat => {
                if (!chat || chat.finalizada) return;
                this.recuperar(chat, ahora);
                chat.tiempo = Math.max(0, Math.floor((ahora - chat.motorV2.inicioMs) / 1000));
                chat.aht = Math.max(0, Math.floor((ahora - (Number.isFinite(chat.inicioAHT) ? chat.inicioAHT : ahora)) / 1000));
            });
            this.estadisticas = { ticks:0, pausasRecuperadas:0, ultimoTick:ahora };
            STATE.guardarEnDisco();
        },

        tick() {
            const ahora = Date.now();
            if (this.estadisticas.ultimoTick > 0 && ahora - this.estadisticas.ultimoTick > 2200) this.estadisticas.pausasRecuperadas += 1;
            this.estadisticas.ultimoTick = ahora;
            this.estadisticas.ticks += 1;
            let cambios = false;
            Object.values(STATE.memoriaChats || {}).forEach(chat => {
                if (!chat || chat.finalizada) return;
                if (!Number.isFinite(chat.inicioAHT)) { chat.inicioAHT = ahora; cambios = true; }
                this.recuperar(chat, ahora);
                const aht = Math.max(0, Math.floor((ahora - chat.inicioAHT) / 1000));
                const tiempo = Math.max(0, Math.floor((ahora - chat.motorV2.inicioMs) / 1000));
                if (chat.aht !== aht || chat.tiempo !== tiempo) cambios = true;
                chat.aht = aht;
                chat.tiempo = tiempo;
                const visual = INTERACCION_NORMAL.visualizar(chat);
                if (chat.tipo === 'seguimiento' && visual.nivel > chat.motorV2.nivelAvisado) {
                    chat.motorV2.nivelAvisado = visual.nivel;
                    cambios = true;
                    if (!STATE.modoLlamadasActivo) AUDIO_ENGINE.reproducir(visual.nivel === 2 ? 'urgente' : 'notificacion', {
                        chat, evento:`seguimiento:${chat.interaccionId || chat.taskId || chat.nombreCliente}:${chat.motorV2.inicioMs}:${visual.nivel}`
                    });
                }
            });
            return cambios;
        }
    };

    // =========================================================================
    // 5. CRM OBSERVER
    // =========================================================================
    const CRM_OBSERVER = {
        prepararIdentidadPestana(pestaña, nombre, ocurrencia) {
            let enlace = UTILS.identidadesPestanas.get(pestaña);
            if (!nombre) return;
            const clave = `cliente:${UTILS.pointerNormalizer(nombre).toLowerCase()}|instancia:${ocurrencia}`;
            const provisional = enlace && STATE.memoriaChats[enlace.clave];
            if (enlace?.clave !== clave && provisional?.nombrePendiente) {
                const anterior = STATE.memoriaChats[clave];
                // Solo recupera una coincidencia nominal única. Nunca usa task-tab-0/1/2.
                const coincidencias = CRM_CACHE.pestanas().filter(tab =>
                    UTILS.pointerNormalizer(UTILS.leerNombrePestanaChat(tab)).toLowerCase() ===
                    UTILS.pointerNormalizer(nombre).toLowerCase());
                if (anterior && !anterior.finalizada && coincidencias.length === 1) {
                    STATE.historialEmergencia = STATE.historialEmergencia.filter(item => item.taskId !== provisional.interaccionId);
                    STATE.guardarHistorialEmergencia();
                } else if (!anterior) {
                    STATE.memoriaChats[clave] = provisional;
                } else return;
                delete STATE.memoriaChats[enlace.clave];
                if (STATE.eliminadosVoluntariamente.delete(enlace.clave)) STATE.eliminadosVoluntariamente.add(clave);
                STATE._lastKeysStr = '';
            }
            enlace = { clave };
            UTILS.identidadesPestanas.set(pestaña, enlace);
            const chat = STATE.memoriaChats[clave];
            if (chat) {
                chat.nombreCliente = nombre;
                chat.nombrePendiente = false;
                if (chat.registroPendiente) {
                    chat.registroPendiente = false;
                    STATE.registrarInicioInteraccion(clave, chat);
                    this.programarClasificacion(clave);
                }
                STATE.guardarEnDisco();
            }
        },
        candidatoLlamadaClave: '',
        confirmacionesCandidatoLlamada: 0,
        ultimaConfirmacionCandidatoLlamada: 0,
        pestañasPendientesNombre: new Map(),
        reintentoNombrePendiente: null,

        registrarPestanaPendienteNombre(pestaña) {
            if (!pestaña) return;
            const taskId = UTILS.extraerTaskId(pestaña);
            const clave = taskId ? `task:${taskId}` : pestaña;
            const ahora = Date.now();
            const existente = this.pestañasPendientesNombre.get(clave);
            if (!existente) this.pestañasPendientesNombre.set(clave, { inicio: ahora, pestaña, taskId });
            const inicio = existente?.inicio || ahora;
            if (ahora - inicio < 15000 && !this.reintentoNombrePendiente) {
                this.reintentoNombrePendiente = setTimeout(() => {
                    this.reintentoNombrePendiente = null;
                    CRM_CACHE.invalidar('pestanas');
                    this.escanear();
                }, ahora - inicio < 3000 ? 120 : 500);
            } else if (ahora - inicio >= 15000) {
                this.pestañasPendientesNombre.delete(clave);
            }
        },

        consumirInicioPendienteNombre(pestaña, taskId = '') {
            const claves = [];
            if (taskId) claves.push(`task:${taskId}`);
            claves.push(pestaña);
            for (const clave of claves) {
                const pendiente = this.pestañasPendientesNombre.get(clave);
                if (!pendiente) continue;
                this.pestañasPendientesNombre.delete(clave);
                return pendiente.inicio;
            }
            // Si el CRM reemplazó por completo el nodo vacío, conserva el inicio
            // del único cuadro pendiente reciente en vez de perder la interacción.
            const ahora = Date.now();
            const recientes = Array.from(this.pestañasPendientesNombre.entries())
                .filter(([, dato]) => ahora - dato.inicio < 10000);
            if (recientes.length === 1) {
                this.pestañasPendientesNombre.delete(recientes[0][0]);
                return recientes[0][1].inicio;
            }
            return ahora;
        },

        esElementoSuite(elemento) {
            return Boolean(elemento?.closest?.('#reloj-automatico-plata,#panel-cronometros-plata,#ventana-respuestas-plata,#ventana-kb-plata,#panel-bloc-notas-llamadas,#btn-toggle-modo-llamadas,#suite-llamadas-pendientes,#suite-paleta-comandos,#suite-noticia-editor,#suite-interaccion-normal,.suite-cronometro-chat-integrado'));
        },

        detectarSenalesLlamada() {
            const visibles = elemento => {
                if (!elemento || this.esElementoSuite(elemento)) return false;
                const rect = elemento.getBoundingClientRect();
                const estilo = getComputedStyle(elemento);
                const limiteSuperior = Math.min(320, Math.max(210, window.innerHeight * 0.32));
                return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < limiteSuperior && estilo.display !== 'none' && estilo.visibility !== 'hidden' && estilo.opacity !== '0';
            };
            const candidatos = Array.from(document.querySelectorAll('button,[role="button"],span,div')).filter(visibles);
            const cronometro = candidatos.find(el => {
                const texto = String(el.innerText || el.textContent || '').replace(/\s+/g, '');
                return el.children.length <= 3 && /^\d{1,2}:\d{2}(?::\d{2})?$/.test(texto);
            });
            const botones = candidatos.filter(el => el.matches?.('button,[role="button"]'));
            const firma = el => [el.innerText, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('data-testid'), el.getAttribute('name')].filter(Boolean).join(' ').toLowerCase();
            const colgar = botones.find(el => {
                const texto = firma(el);
                const estilo = getComputedStyle(el);
                const color = String(estilo.backgroundColor || '');
                const canales = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
                const esBotonRojo = Boolean(canales && Number(canales[1]) >= 180 && Number(canales[1]) > Number(canales[2]) * 1.45 && Number(canales[1]) > Number(canales[3]) * 1.25);
                return /(colgar|hang.?up|end.?call|call.?end|finalizar.?llamada|terminar.?llamada|desconectar.?llamada|rechazar.?llamada|phone.?off)/i.test(texto) || (esBotonRojo && Boolean(el.querySelector('svg')));
            });
            const controlAudio = botones.find(el => /(silenciar|mute|unmute|micr[oó]fono|microphone|audio|altavoz|speaker|activar.?audio|desactivar.?audio)/i.test(firma(el)));
            return {
                activa: Boolean(colgar && (cronometro || controlAudio)),
                cronometro,
                colgar,
                controlAudio
            };
        },

        reiniciarConfirmacionCandidatoLlamada() {
            this.candidatoLlamadaClave = '';
            this.confirmacionesCandidatoLlamada = 0;
            this.ultimaConfirmacionCandidatoLlamada = 0;
        },

        obtenerSegundosCronometroLlamada(elemento) {
            const texto = String(elemento?.innerText || elemento?.textContent || '').replace(/\s+/g, '');
            const partes = texto.split(':').map(Number);
            if (partes.some(valor => !Number.isFinite(valor))) return null;
            if (partes.length === 2) return partes[0] * 60 + partes[1];
            if (partes.length === 3) return partes[0] * 3600 + partes[1] * 60 + partes[2];
            return null;
        },

        obtenerCandidatoLlamadaActual(senales = {}) {
            const chatsDisponibles = Object.entries(STATE.memoriaChats || {})
                .filter(([, chat]) => chat && !chat.finalizada && chat.tipoInteraccion !== 'LLAMADA');

            // Cuando el CRM muestra el tiempo transcurrido, se enlaza la llamada
            // con la interacción cuyo inicio está más cerca de ese cronómetro.
            // Esto evita adjudicarla a otro chat que el agente abra durante la llamada.
            const segundosLlamada = this.obtenerSegundosCronometroLlamada(senales.cronometro);
            if (Number.isFinite(segundosLlamada) && chatsDisponibles.length) {
                const inicioEstimado = Date.now() - segundosLlamada * 1000;
                const ordenados = chatsDisponibles
                    .filter(([, chat]) => Number.isFinite(Number(chat.inicioAHT)))
                    .sort((a, b) => Math.abs(Number(a[1].inicioAHT) - inicioEstimado) - Math.abs(Number(b[1].inicioAHT) - inicioEstimado));
                if (ordenados.length && Math.abs(Number(ordenados[0][1].inicioAHT) - inicioEstimado) <= 120000) {
                    return { clave: ordenados[0][0], chat: ordenados[0][1] };
                }
            }

            const claveDirecta = STATE.clienteActualKey;
            const chatDirecto = claveDirecta ? STATE.memoriaChats[claveDirecta] : null;
            if (chatDirecto && !chatDirecto.finalizada && chatDirecto.tipoInteraccion !== 'LLAMADA') return { clave: claveDirecta, chat: chatDirecto };

            const candidatos = chatsDisponibles
                .filter(([, chat]) => chat.esPestanaActiva === true)
                .sort((a, b) => (Number(b[1].inicioAHT) || 0) - (Number(a[1].inicioAHT) || 0));
            return candidatos.length ? { clave: candidatos[0][0], chat: candidatos[0][1] } : null;
        },

        confirmarLlamadaNoClasificada(senales) {
            if (!senales?.activa) {
                this.reiniciarConfirmacionCandidatoLlamada();
                return null;
            }

            const candidato = this.obtenerCandidatoLlamadaActual(senales);
            if (!candidato || candidato.chat.tipoInteraccion === 'LLAMADA') {
                this.reiniciarConfirmacionCandidatoLlamada();
                return candidato?.chat || null;
            }

            const ahora = Date.now();
            const mismaLectura = this.candidatoLlamadaClave === candidato.clave
                && ahora - this.ultimaConfirmacionCandidatoLlamada <= 2200;
            this.candidatoLlamadaClave = candidato.clave;
            this.confirmacionesCandidatoLlamada = mismaLectura ? this.confirmacionesCandidatoLlamada + 1 : 1;
            this.ultimaConfirmacionCandidatoLlamada = ahora;

            // Dos escaneos consecutivos evitan confundir el cronometro global o
            // los botones de resultado de un chat con los controles de llamada.
            if (this.confirmacionesCandidatoLlamada < 2) return null;

            clearTimeout(candidato.chat.timeoutClasificacion);
            candidato.chat.timeoutClasificacion = null;
            STATE.actualizarTipoInteraccion(candidato.chat, 'LLAMADA', true);
            candidato.chat.llamadaFinalizada = false;
            candidato.chat.ultimaSenalLlamada = ahora;
            STATE.iniciarLlamadaAutomatica(candidato.chat);
            UI_MANAGER.establecerModoLlamadas(true, true);
            STATE.guardarEnDisco();
            this.reiniciarConfirmacionCandidatoLlamada();
            return candidato.chat;
        },

        programarClasificacion(claveChat, intento = 0) {
            const chat = STATE.memoriaChats[claveChat];
            if (!chat || chat.tipoInteraccionBloqueado || chat.finalizada) return;
            const otraLlamadaActiva = Object.values(STATE.memoriaChats || {}).some(item => item && item !== chat && item.tipoInteraccion === 'LLAMADA' && !item.llamadaFinalizada && !item.finalizada);
            if (otraLlamadaActiva && UI_MANAGER.hayChatDisponibleParaScripts()) {
                STATE.actualizarTipoInteraccion(chat, 'CHAT');
                UI_MANAGER.sincronizarDisponibilidadChatDuranteLlamada();
                STATE.guardarEnDisco();
                return;
            }
            const senales = this.detectarSenalesLlamada();
            if (senales.activa && chat.esPestanaActiva === true) {
                STATE.actualizarTipoInteraccion(chat, 'LLAMADA');
                chat.ultimaSenalLlamada = Date.now();
                STATE.iniciarLlamadaAutomatica(chat);
                UI_MANAGER.establecerModoLlamadas(true, true);
                STATE.guardarEnDisco();
                return;
            }
            const esperas = [450, 850, 1350, 1900];
            if (intento < esperas.length) {
                clearTimeout(chat.timeoutClasificacion);
                chat.timeoutClasificacion = setTimeout(() => this.programarClasificacion(claveChat, intento + 1), esperas[intento]);
                return;
            }
            STATE.actualizarTipoInteraccion(chat, 'CHAT');
            const hayLlamada = Object.values(STATE.memoriaChats).some(item => item && item.tipoInteraccion === 'LLAMADA' && !item.llamadaFinalizada);
            if (!hayLlamada && STATE.modoLlamadasAutomatico) UI_MANAGER.establecerModoLlamadas(false, true);
            STATE.guardarEnDisco();
        },

        evaluarLlamadaActiva() {
            const senales = this.detectarSenalesLlamada();
            let chat = Object.values(STATE.memoriaChats || {})
                .filter(item => item && item.tipoInteraccion === 'LLAMADA' && !item.llamadaFinalizada && !item.finalizada)
                .sort((a, b) => (Number(b.inicioAHT) || 0) - (Number(a.inicioAHT) || 0))[0];
            if (!chat) chat = this.confirmarLlamadaNoClasificada(senales);
            else this.reiniciarConfirmacionCandidatoLlamada();
            if (!chat) return;
            if (senales.activa) {
                chat.ultimaSenalLlamada = Date.now();
                if (!STATE.modoLlamadasActivo) UI_MANAGER.establecerModoLlamadas(true, true);
                UI_MANAGER.sincronizarDisponibilidadChatDuranteLlamada();
                return;
            }
            if (!chat.ultimaSenalLlamada || Date.now() - chat.ultimaSenalLlamada < 3000) return;
            chat.llamadaFinalizada = true;
            chat.finLlamadaISO = new Date().toISOString();
            STATE.finalizarLlamadaAutomatica(chat);
            STATE.guardarRegistroHistorial(chat);
            const quedanLlamadas = Object.values(STATE.memoriaChats).some(item => item && item !== chat && item.tipoInteraccion === 'LLAMADA' && !item.llamadaFinalizada);
            if (!quedanLlamadas) UI_MANAGER.establecerModoLlamadas(false, true);
        },

        registrarResultadoVisible(resultado) {
            const chat = STATE.memoriaChats[STATE.clienteActualKey];
            if (!chat || chat.finalizada) return;
            chat.resultado = resultado;
            STATE.guardarRegistroHistorial(chat);
            STATE.guardarEnDisco();
        },

        obtenerEstadoNotificacionPestana(pestaña) {
            if (!pestaña) return { cantidad: 0, hayIndicador: false, indicadorSemantico: false };

            const nodos = Array.from(pestaña.querySelectorAll('*'));
            let cantidad = 0;
            let indicadorSemantico = false;

            for (const el of nodos) {
                const texto = String(el.innerText || el.textContent || '').trim();
                if (el.children.length === 0 && /^\d{1,2}$/.test(texto)) {
                    const numero = parseInt(texto, 10);
                    if (Number.isFinite(numero)) cantidad = Math.max(cantidad, numero);
                }

                const firma = [
                    el.getAttribute?.('data-testid'),
                    el.getAttribute?.('aria-label'),
                    el.getAttribute?.('title'),
                    typeof el.className === 'string' ? el.className : ''
                ].filter(Boolean).join(' ').toLowerCase();

                if (/(unread|notification|new[-_ ]?message|message[-_ ]?badge|mensajes?[-_ ]?nuevos?|sin[-_ ]?leer|notificacion)/i.test(firma)) {
                    const rect = el.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && getComputedStyle(el).display !== 'none') {
                        indicadorSemantico = true;
                    }
                }
            }

            const firmaPestana = [
                pestaña.getAttribute('aria-label'),
                pestaña.getAttribute('title'),
                pestaña.getAttribute('data-state')
            ].filter(Boolean).join(' ').toLowerCase();
            if (/(unread|notification|new[-_ ]?message|mensajes?[-_ ]?nuevos?|sin[-_ ]?leer|notificacion)/i.test(firmaPestana)) {
                indicadorSemantico = true;
            }

            return {
                cantidad,
                indicadorSemantico,
                hayIndicador: cantidad > 0 || indicadorSemantico
            };
        },

        activarRespuestaCliente(chat, cantidadActual = 0, reproducirSonido = true) {
            if (!chat) return;
            {
                chat.tiempo = 0;
                chat.tipo = 'cliente_respondio';
                chat.sonadoVencido = false;
                MOTOR_CRONOMETROS_V2.registrarFase(chat, 120, 'cliente_respondio');
            }
            chat.respuestaPendienteSinAbrir = true;
            chat.ultimoNivelNotificaciones = Math.max(chat.ultimoNivelNotificaciones || 0, cantidadActual || 0);
            STATE.guardarEnDisco();
            if (reproducirSonido && !STATE.modoLlamadasActivo) AUDIO_ENGINE.reproducir('notificacion', { chat, evento:`respuesta-pestana:${chat.interaccionId || chat.taskId || ''}:${cantidadActual || chat.ultimoNivelNotificaciones || 0}` });
        },

        capturarRespuestaAntesDeAbrir(pestaña) {
            if (!pestaña || UTILS.esPestanaActiva(pestaña)) return;
            const pestañas = CRM_CACHE.pestanas();
            const ocurrencias = {};

            for (const tab of pestañas) {
                const textoDiv = tab.querySelector('.text-nowrap, .text-ellipsis') || tab;
                const nombre = UTILS.pointerNormalizer(UTILS.textToClean(textoDiv ? textoDiv.innerText.trim() : tab.innerText.trim()));
                if (!nombre || nombre.length <= 1) continue;
                ocurrencias[nombre] = (ocurrencias[nombre] || 0) + 1;
                if (tab !== pestaña) continue;

                const clave = UTILS.obtenerClaveChat(tab, nombre, ocurrencias[nombre]);
                const chat = STATE.memoriaChats[clave];
                if (!chat) return;
                const indicador = this.obtenerEstadoNotificacionPestana(tab);
                if (indicador.hayIndicador && !chat.respuestaPendienteSinAbrir) {
                    this.activarRespuestaCliente(chat, indicador.cantidad);
                }
                return;
            }
        },

        escanear() {
            try {
                const pestañasDeChat = CRM_CACHE.pestanas();

                if (pestañasDeChat.length === 0) {
                    // La vista se limpia en el siguiente cuadro visual, pero los
                    // registros continúan vivos durante el margen de seguridad.
                    const ahoraAusencia = Date.now();
                    let cambioVisual = false;
                    Object.values(STATE.memoriaChats || {}).forEach(chat => {
                        if (!chat || chat.finalizada) return;
                        if (!chat.ausenteDesde) chat.ausenteDesde = ahoraAusencia;
                        if (!chat.ocultoTemporal) {
                            chat.ocultoTemporal = true;
                            cambioVisual = true;
                        }
                    });
                    if (STATE.clienteActualKey !== null || STATE.clienteActualEnPantalla !== null) {
                        STATE.clienteActualKey = null;
                        STATE.clienteActualEnPantalla = null;
                        STATE.idUltimoMensajeCliente = '';
                        cambioVisual = true;
                    }
                    if (cambioVisual) {
                        STATE._lastKeysStr = 'CAMBIO_VISUAL_SIN_PESTANAS';
                        STATE.guardarEnDisco();
                        COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio');
                    }

                    // El CRM puede retirar las pestañas brevemente mientras vuelve a renderizar.
                    // Se da un margen antes de borrar los cronómetros para no perderlos por accidente.
                    if (!STATE.sinChatsDesde) STATE.sinChatsDesde = Date.now();
                    if (Date.now() - STATE.sinChatsDesde < 3000) {
                        if (!STATE.timeoutRevisionSinChats) {
                            STATE.timeoutRevisionSinChats = setTimeout(() => {
                                STATE.timeoutRevisionSinChats = null;
                                CRM_OBSERVER.escanear();
                            }, 1000);
                        }
                        return;
                    }

                    if (STATE.sistemaCargadoCompletamente && (Object.keys(STATE.memoriaChats).length > 0 || STATE.clienteActualKey !== null)) {
                        Object.keys(STATE.memoriaChats).forEach(clave => {
                            const chat = STATE.memoriaChats[clave];
                            STATE.finalizarInteraccion(clave, 'CRM_FINALIZADA', chat?.ausenteDesde);
                        });
                        STATE.memoriaChats = {};
                        STATE.clienteActualEnPantalla = null;
                        STATE.clienteActualKey = null;
                        STATE.idUltimoMensajeCliente = "";
                        STATE.guardarEnDisco();
                        COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio');
                    }
                    return;
                } else {
                    STATE.sinChatsDesde = null;
                    if (STATE.timeoutRevisionSinChats) {
                        clearTimeout(STATE.timeoutRevisionSinChats);
                        STATE.timeoutRevisionSinChats = null;
                    }
                }

                const clavesVivas = new Set();
                const ocurrenciasNombres = {};
                const claveActivaAnterior = STATE.clienteActualKey;
                let nombreAbiertoCentral = null;
                let claveAbiertaCentral = null;
                let taskIdAbiertoCentral = '';
                let cambioVisualChats = false;

                pestañasDeChat.forEach((pestaña) => {
                    const nombreReal = UTILS.leerNombrePestanaChat(pestaña);
                    const normalizado = UTILS.pointerNormalizer(nombreReal);
                    const ocurrencia = (ocurrenciasNombres[normalizado] || 0) + 1;
                    this.prepararIdentidadPestana(pestaña, normalizado, ocurrencia);
                    const nombreCliente = UTILS.obtenerNombrePestanaChat(pestaña);

                    if (nombreCliente && nombreCliente.length > 1) {
                        const nombreLimpio = UTILS.pointerNormalizer(nombreCliente);
                        const taskId = UTILS.extraerTaskId(pestaña);
                        ocurrenciasNombres[nombreLimpio] = (ocurrenciasNombres[nombreLimpio] || 0) + 1;
                        const claveChat = UTILS.obtenerClaveChat(pestaña, nombreLimpio, ocurrenciasNombres[nombreLimpio]);
                        clavesVivas.add(claveChat);

                        const esActivo = UTILS.esPestanaActiva(pestaña);
                        const esCambioHaciaEstaPestana = esActivo && claveChat !== claveActivaAnterior;
                        if (esActivo) {
                            nombreAbiertoCentral = nombreLimpio;
                            claveAbiertaCentral = claveChat;
                            taskIdAbiertoCentral = taskId;
                        }

                        const indicadorNotificacion = this.obtenerEstadoNotificacionPestana(pestaña);
                        const numeroNotificacionesActual = indicadorNotificacion.cantidad;

                        if (!STATE.memoriaChats[claveChat] && !STATE.eliminadosVoluntariamente.has(claveChat)) {
                            const ahoraApertura = Date.now();
                            const emergenciaId = `em_${ahoraApertura}_${Math.random().toString(36).slice(2, 9)}`;
                            STATE.memoriaChats[claveChat] = {
                                tiempo: 0,
                                tipo: 'bienvenida',
                                aht: 0,
                                inicioAHT: ahoraApertura,
                                taskId,
                                emergenciaId,
                                interaccionId: emergenciaId,
                                nombrePendiente: !nombreReal,
                                registroPendiente: !nombreReal,
                                tipoInteraccion: 'PENDIENTE',
                                tipoInteraccionBloqueado: false,
                                resultado: '',
                                finalizada: false,
                                ultimaVistaCRM: ahoraApertura,
                                ausenteDesde: 0,
                                ocultoTemporal: false,
                                esPestanaActiva: esActivo,
                                nombreCliente: nombreLimpio,
                                sonadoVencido: false,
                                ultimoNivelNotificaciones: numeroNotificacionesActual,
                                ultimoIndicadorNoLeido: indicadorNotificacion.hayIndicador,
                                respuestaPendienteSinAbrir: false,
                                idUltimoMensajeCliente: ''
                            };
                            cambioVisualChats = true;
                            MOTOR_CRONOMETROS_V2.registrarFase(STATE.memoriaChats[claveChat], 60, 'bienvenida');
                            if (nombreReal) STATE.registrarInicioInteraccion(claveChat, STATE.memoriaChats[claveChat]);
                            STATE.guardarEnDisco();
                            STATE.registrarInteraccionEmergencia(
                                STATE.memoriaChats[claveChat].interaccionId,
                                nombreLimpio
                            );
                            if (nombreReal) this.programarClasificacion(claveChat);
                            if (!STATE.modoLlamadasActivo) AUDIO_ENGINE.reproducir('notificacion', { chat:STATE.memoriaChats[claveChat], evento:`chat-nuevo:${STATE.memoriaChats[claveChat].interaccionId}` });
                        } else if (STATE.memoriaChats[claveChat]) {
                            const chat = STATE.memoriaChats[claveChat];
                            chat.ultimaVistaCRM = Date.now();
                            if (chat.ausenteDesde || chat.ocultoTemporal) cambioVisualChats = true;
                            chat.ausenteDesde = 0;
                            chat.ocultoTemporal = false;
                            chat.esPestanaActiva = esActivo;
                            if (chat.interrumpida) {
                                chat.interrumpida = false;
                                if (chat.resultado === 'INTERRUMPIDA') chat.resultado = '';
                            }
                            if (!Number.isFinite(chat.inicioAHT)) {
                                chat.inicioAHT = Date.now();
                                chat.aht = 0;
                            }
                            if (!chat.emergenciaId) {
                                chat.emergenciaId = `em_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
                            }
                            if (!chat.interaccionId) {
                                chat.interaccionId = chat.taskId || taskId || chat.emergenciaId;
                                chat.tipoInteraccion = chat.tipoInteraccion || 'PENDIENTE';
                                STATE.registrarInicioInteraccion(claveChat, chat);
                                this.programarClasificacion(claveChat);
                            }
                            if (taskId) chat.taskId = taskId;
                            chat.nombreCliente = nombreLimpio;
                            STATE.registrarInteraccionEmergencia(chat.interaccionId, nombreLimpio);
                            const nivelPrevio = chat.ultimoNivelNotificaciones || 0;
                            const indicadorPrevio = chat.ultimoIndicadorNoLeido === true;
                            const aumentoNumerico = numeroNotificacionesActual > nivelPrevio;
                            const aparecioIndicador = !esActivo && indicadorNotificacion.hayIndicador && !indicadorPrevio;

                            // La respuesta se procesa antes que el cambio de pestaña. Así,
                            // abrir el chat no borra una notificación que llegó en segundo plano.
                            if (!esActivo && (aumentoNumerico || aparecioIndicador)) {
                                const esNuevaRespuesta = aumentoNumerico || !chat.respuestaPendienteSinAbrir;
                                if (esNuevaRespuesta) this.activarRespuestaCliente(chat, numeroNotificacionesActual);
                            }

                            if (esCambioHaciaEstaPestana) {
                                // La respuesta ya fue registrada arriba o por el clic en captura.
                                // Al abrirla se libera el seguro para detectar la siguiente.
                                chat.respuestaPendienteSinAbrir = false;
                                chat.ultimoIndicadorNoLeido = false;
                                chat.ultimoNivelNotificaciones = numeroNotificacionesActual;
                                STATE.guardarEnDisco();
                            } else if (esActivo) {
                                chat.respuestaPendienteSinAbrir = false;
                                chat.ultimoIndicadorNoLeido = false;
                                if (numeroNotificacionesActual === 0 && nivelPrevio > 0) chat.ultimoNivelNotificaciones = 0;
                            } else {
                                chat.ultimoIndicadorNoLeido = indicadorNotificacion.hayIndicador;
                                if (numeroNotificacionesActual === 0 && nivelPrevio > 0 && !indicadorNotificacion.hayIndicador) {
                                    chat.ultimoNivelNotificaciones = 0;
                                }
                            }
                        }
                    }
                });

                if (claveAbiertaCentral) {
                    const esNuevoChatAbierto = (claveAbiertaCentral !== STATE.clienteActualKey);
                    STATE.clienteActualEnPantalla = nombreAbiertoCentral;
                    STATE.clienteActualKey = claveAbiertaCentral;

                    const chatAbierto = STATE.memoriaChats[STATE.clienteActualKey];
                    if (chatAbierto?.emergenciaId && !chatAbierto.nombrePendiente) {
                        const uidActual = UTILS.extraerUIDClienteActual();
                        if (uidActual) chatAbierto.uidCliente = uidActual;
                        STATE.registrarInteraccionEmergencia(
                            chatAbierto.interaccionId || chatAbierto.emergenciaId,
                            nombreAbiertoCentral,
                            uidActual
                        );
                        if (uidActual) STATE.guardarRegistroHistorial(chatAbierto);
                    }

                    if (STATE.modoLlamadasActivo && esNuevoChatAbierto) {
                        UI_MANAGER.renderizarContenidoBlocNotas();
                    }

                    const todosLosMensajes = CRM_CACHE.mensajes();
                    const mensajesCliente = todosLosMensajes.filter(msg => {
                        return msg.querySelector('.bg-neutral-100') ||
                               msg.classList.contains('message-in') ||
                               msg.outerHTML.includes('incoming');
                    });

                    if (mensajesCliente.length > 0) {
                        const ultimoMensajeElemento = mensajesCliente[mensajesCliente.length - 1];
                        const nodoTextoReal = ultimoMensajeElemento.querySelector('.wrap-break-word');
                        const textoMensajeLimpio = nodoTextoReal ? nodoTextoReal.innerText.trim() : ultimoMensajeElemento.innerText.trim();

                        const idMensajeActual = UTILS.obtenerIdMensaje(ultimoMensajeElemento, textoMensajeLimpio, {
                            claveChat:STATE.clienteActualKey,
                            indice:mensajesCliente.length - 1
                        });
                        const idAnterior = chatAbierto?.idUltimoMensajeCliente || STATE.idUltimoMensajeCliente;

                        if (esNuevoChatAbierto) {
                            STATE.idUltimoMensajeCliente = idMensajeActual;
                            if (chatAbierto) chatAbierto.idUltimoMensajeCliente = idMensajeActual;
                        } else if (idAnterior && idAnterior !== idMensajeActual) {
                            STATE.idUltimoMensajeCliente = idMensajeActual;
                            const chat = STATE.memoriaChats[STATE.clienteActualKey];

                            if (chat) {
                                chat.idUltimoMensajeCliente = idMensajeActual;
                                chat.tiempo = 0;
                                chat.tipo = 'cliente_respondio';
                                chat.sonadoVencido = false;
                                MOTOR_CRONOMETROS_V2.registrarFase(chat, 120, 'cliente_respondio');
                                STATE.guardarEnDisco();
                                if (!STATE.modoLlamadasActivo) AUDIO_ENGINE.reproducir('notificacion', { chat, evento:`mensaje:${chat.interaccionId || chat.taskId || ''}:${idMensajeActual}` });
                            }
                        } else if (!idAnterior && chatAbierto) {
                            STATE.idUltimoMensajeCliente = idMensajeActual;
                            chatAbierto.idUltimoMensajeCliente = idMensajeActual;
                        }
                    } else if (esNuevoChatAbierto) {
                        STATE.idUltimoMensajeCliente = "";
                    }
                } else {
                    STATE.clienteActualEnPantalla = null;
                    STATE.clienteActualKey = null;
                    STATE.idUltimoMensajeCliente = "";
                }

                {
                    let modificado = false;
                    for (const n in STATE.memoriaChats) {
                        if (!clavesVivas.has(n)) {
                            const chatAusente = STATE.memoriaChats[n];
                            if (pestañasDeChat.some(tab => !UTILS.leerNombrePestanaChat(tab))) {
                                chatAusente.ocultoTemporal = true;
                                chatAusente.ausenteDesde = 0;
                                continue;
                            }
                            if (!chatAusente.ocultoTemporal) {
                                chatAusente.ocultoTemporal = true;
                                cambioVisualChats = true;
                                modificado = true;
                            }
                            if (!chatAusente.ausenteDesde) {
                                chatAusente.ausenteDesde = Date.now();
                                modificado = true;
                                continue;
                            }
                            if (!STATE.sistemaCargadoCompletamente || Date.now() - chatAusente.ausenteDesde < 2500) continue;
                            STATE.finalizarInteraccion(n, 'CRM_FINALIZADA', chatAusente.ausenteDesde);
                            delete STATE.memoriaChats[n];
                            cambioVisualChats = true;
                            if (STATE.clienteActualKey === n) {
                                STATE.clienteActualKey = null;
                                STATE.clienteActualEnPantalla = null;
                            }
                            modificado = true;
                        }
                    }
                    if (STATE.sistemaCargadoCompletamente) {
                        for (const claveBloqueada of Array.from(STATE.eliminadosVoluntariamente)) {
                            if (!clavesVivas.has(claveBloqueada)) {
                                STATE.eliminadosVoluntariamente.delete(claveBloqueada);
                                modificado = true;
                            }
                        }
                    }
                    if (modificado) STATE.guardarEnDisco();
                }
                if (cambioVisualChats) {
                    STATE._lastKeysStr = 'CAMBIO_VISUAL_CHATS';
                    COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio');
                }
                this.evaluarLlamadaActiva();
                UI_MANAGER.sincronizarDisponibilidadChatDuranteLlamada();
            } catch (e) {
                console.warn('[Suite] No fue posible completar el escaneo del CRM:', e);
            }
        },

        activarSeguimientoTresMinutos(campoConfirmado = null) {
            // El propio campo que originó Enter, click o submit confirma que el
            // agente está respondiendo un chat. No dependemos de que el CRM
            // mantenga visible el recuadro lateral de esa conversación.
            const campoActivo = campoConfirmado && document.body.contains(campoConfirmado)
                ? campoConfirmado
                : UI_MANAGER.obtenerCampoChatEditable();
            if (!campoActivo) return;

            let claveActual = STATE.clienteActualKey;
            let nombreActual = STATE.clienteActualEnPantalla;
            let chatExistente = claveActual ? STATE.memoriaChats[claveActual] : null;

            // En la vista de un solo chat el CRM puede ocultar su pestaña. Si
            // existe una única interacción activa en memoria, esa es la que
            // corresponde al campo desde el que acaba de enviarse la respuesta.
            if (!chatExistente || chatExistente.finalizada) {
                const chatsActivos = Object.entries(STATE.memoriaChats || {})
                    .filter(([, chat]) => chat && !chat.finalizada);
                if (chatsActivos.length === 1) {
                    [claveActual, chatExistente] = chatsActivos[0];
                    nombreActual = chatExistente.nombreCliente || nombreActual || 'Cliente';
                    STATE.clienteActualKey = claveActual;
                    STATE.clienteActualEnPantalla = nombreActual;
                }
            }

            if (!chatExistente) {
                const pestañas = CRM_CACHE.pestanas();
                if (pestañas.length === 1) {
                    nombreActual = UTILS.pointerNormalizer(UTILS.obtenerNombrePestanaChat(pestañas[0]));
                    claveActual = UTILS.obtenerClaveChat(pestañas[0], nombreActual, 1);
                    chatExistente = STATE.memoriaChats[claveActual];
                    if (chatExistente) {
                        STATE.clienteActualKey = claveActual;
                        STATE.clienteActualEnPantalla = nombreActual;
                    }
                }
            }
            if (!claveActual || !nombreActual || !chatExistente) return;

            STATE.eliminadosVoluntariamente.delete(claveActual);
            STATE.memoriaChats[claveActual] = {
                ...(chatExistente || {}),
                tiempo: 0,
                tipo: 'seguimiento',
                aht: chatExistente ? chatExistente.aht || 0 : 0,
                inicioAHT: chatExistente?.inicioAHT || Date.now(),
                taskId: chatExistente?.taskId || '',
                emergenciaId: chatExistente?.emergenciaId || `em_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                nombreCliente: nombreActual,
                sonadoVencido: false,
                ultimoNivelNotificaciones: 0,
                ultimoIndicadorNoLeido: false,
                respuestaPendienteSinAbrir: false
            };
            MOTOR_CRONOMETROS_V2.registrarFase(STATE.memoriaChats[claveActual], 180, 'seguimiento');
            STATE.guardarEnDisco();
            COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas');

        }
    };

    // =========================================================================
    // 6. PROGRAMADOR DE ACTUALIZACIONES AUTOMÁTICAS Y RESPALDOS
    // =========================================================================
    const SYSTEM_SCHEDULER = {
        configurarAutorrecargaDiaria() {
            const ahora = new Date();
            const proximaRecarga = new Date(ahora);

            proximaRecarga.setHours(CONFIG.HORA_ACTUALIZACION.hora, CONFIG.HORA_ACTUALIZACION.minuto, 0, 0);

            if (ahora >= proximaRecarga) {
                proximaRecarga.setDate(proximaRecarga.getDate() + 1);
            }

            const tiempoEsperaMs = proximaRecarga.getTime() - ahora.getTime();

            const intentarRecarga = () => {
                const campoChat = CRM_CACHE.camposChat()[0] || null;
                const hayBorrador = !!(campoChat && campoChat.value && campoChat.value.trim());
                const hayCampoEnEdicion = !!document.querySelector('textarea:focus, input:focus, select:focus');

                if (hayBorrador || hayCampoEnEdicion) {
                    console.log('[Suite] Recarga diaria pospuesta: hay contenido o un campo en edición.');
                    setTimeout(intentarRecarga, 5 * 60 * 1000);
                    return;
                }

                STATE.guardarEnDisco();
                window.location.reload();
            };

            setTimeout(intentarRecarga, tiempoEsperaMs);
        },

        configurarRespaldoDiario() {
            const calcularTiempoSiguienteRespaldo = () => {
                const ahora = new Date();
                const proximoRespaldo = new Date(ahora);

                proximoRespaldo.setHours(CONFIG.HORA_RESPALDO_DIARIO.hora, CONFIG.HORA_RESPALDO_DIARIO.minuto, 0, 0);

                if (ahora >= proximoRespaldo) {
                    proximoRespaldo.setDate(proximoRespaldo.getDate() + 1);
                }

                return proximoRespaldo.getTime() - ahora.getTime();
            };

            const ejecutarRespaldoProgramado = () => {
                CLOUD_SYNC.guardarScripts(STATE.scriptsPersonalizados);
                CLOUD_SYNC.guardarLlamadasNube(STATE.registroLlamadas);
                setTimeout(ejecutarRespaldoProgramado, calcularTiempoSiguienteRespaldo());
            };

            setTimeout(ejecutarRespaldoProgramado, calcularTiempoSiguienteRespaldo());
        }
    };

    // =========================================================================
    // 7. INICIALIZACIÓN
    // =========================================================================
    async function inicializarSuite() {
        // Etapa 1: las ventanas aparecen con su tema y posición local apenas el
        // DOM está disponible. No se muestran datos de otro agente sin validar.
        STATE.precargarInterfazLocal();
        UI_MANAGER.inicializar();
        UI_MANAGER.mostrarEstadoArranque();
        ACTUALIZADOR_SUITE.iniciar();

        // Etapa 2: Google, Firebase y los datos del agente se validan en segundo
        // plano. La estructura existente se actualiza; no se destruye ni recrea.
        await STATE.cargarConfiguraciones();
        STATE.inicioSincronizando = false;
        UI_MANAGER.sincronizarInterfazCargada();
        UI_MANAGER.ocultarEstadoArranque();
        NUBE_COMPARTIDA.iniciarEnSegundoPlano();
        SYSTEM_SCHEDULER.configurarAutorrecargaDiaria();
        SYSTEM_SCHEDULER.configurarRespaldoDiario();

        UI_MANAGER.actualizarPanelLateral();
        UI_MANAGER.actualizarCronometrosEnRecuadrosCRM();
        UI_MANAGER.refrescarSoloTextosRespuestas();

        CRM_OBSERVER.escanear();

        const escanearDebounced = UTILS.debounce(() => CRM_OBSERVER.escanear(), 150);

        const observador = new MutationObserver((mutations) => {
            let contieneCambiosDelCRM = false;
            for (let i = 0; i < mutations.length; i++) {
                const targetOriginal = mutations[i].target;
                const targetEl = targetOriginal && targetOriginal.nodeType === Node.TEXT_NODE
                    ? targetOriginal.parentElement
                    : targetOriginal;
                if (targetEl && typeof targetEl.closest === 'function') {
                    if (mutations[i].type === 'attributes' && !targetEl.closest('[data-testid*="task-tab-"]')) {
                        continue;
                    }
                    if (!targetEl.closest('#reloj-automatico-plata') &&
                        !targetEl.closest('#panel-cronometros-plata') &&
                        !targetEl.closest('#ventana-respuestas-plata') &&
                        !targetEl.closest('#modal-editor-scripts-plata') &&
                        !targetEl.closest('#modal-bienvenida-apodo-plata') &&
                        !targetEl.closest('#panel-bloc-notas-llamadas') &&
                        !targetEl.closest('#suite-llamadas-pendientes') &&
                        !targetEl.closest('#suite-noticia-editor') &&
                        !targetEl.closest('#suite-interaccion-normal') &&
                        !targetEl.closest('#btn-toggle-modo-llamadas') &&
                        !targetEl.closest('.suite-cronometro-chat-integrado')) {
                        contieneCambiosDelCRM = true;
                        break;
                    }
                }
            }
            if (contieneCambiosDelCRM) {
                CRM_CACHE.invalidar('pestanas', 'campos-chat', 'mensajes', 'uid');
                escanearDebounced();
            }
        });

        if (document.body) observador.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'aria-label', 'title', 'data-state', 'data-testid']
        });

        const ultimosEnviosAgente = new Map();
        const registrarEnvioAgente = campo => {
            if (!UTILS.esTextareaChat(campo) || !String(campo.value || '').trim()) return;
            const ahora = Date.now();
            // Enter puede generar también submit; ambos representan el mismo envío.
            const clave = STATE.clienteActualKey;
            if (!clave) return;
            if (ahora - (ultimosEnviosAgente.get(clave) || 0) < 700) return;
            ultimosEnviosAgente.set(clave, ahora);
            for (const [id, fecha] of ultimosEnviosAgente) if (ahora - fecha > 10000) ultimosEnviosAgente.delete(id);
            CRM_OBSERVER.activarSeguimientoTresMinutos(campo);
        };

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && UTILS.esTextareaChat(e.target)) {
                registrarEnvioAgente(e.target);
            }
        }, true);

        // Respaldo para versiones del CRM que procesan el envío como submit y
        // no conservan un data-testid estable en su botón.
        document.addEventListener('submit', (e) => {
            const campo = e.target?.querySelector?.('textarea[data-testid="chat-message-input"]');
            registrarEnvioAgente(campo);
        }, true);

        document.addEventListener('click', (e) => {
            const botonResultado = e.target.closest?.('button,[role="button"]');
            if (botonResultado && !CRM_OBSERVER.esElementoSuite(botonResultado)) {
                const textoResultado = UTILS.pointerNormalizer(botonResultado.innerText || botonResultado.textContent || '').trim().toLowerCase();
                if (textoResultado === 'resuelto') CRM_OBSERVER.registrarResultadoVisible('RESUELTO');
                if (textoResultado === 'no se resolvió' || textoResultado === 'no se resolvio') CRM_OBSERVER.registrarResultadoVisible('NO_RESUELTO');
            }

            const botonCopiarUID = e.target.closest?.('ad-copy-button[componentname="Copy User ID"]');
            if (botonCopiarUID) {
                // No interfiere con la copia original del CRM. Solo lee el UID que
                // ya está en la página y lo reserva o vincula a la llamada nueva.
                setTimeout(() => {
                    const uid = UTILS.extraerUIDClienteActual();
                    if (uid) STATE.registrarUIDDetectado(uid);
                }, 0);
            }

            const pestañaObjetivo = e.target.closest('[data-testid*="task-tab-"]');
            if (pestañaObjetivo) {
                // Este listener trabaja en captura: conserva la notificación antes
                // de que el CRM la retire al abrir la conversación.
                CRM_OBSERVER.capturarRespuestaAntesDeAbrir(pestañaObjetivo);
                setTimeout(() => CRM_OBSERVER.escanear(), 50);
                return;
            }
            const btn = e.target.closest?.('button,[role="button"]');
            if (btn && !CRM_OBSERVER.esElementoSuite(btn)) {
                const firmaBoton = [
                    btn.getAttribute('data-testid'),
                    btn.getAttribute('aria-label'),
                    btn.getAttribute('title')
                ].filter(Boolean).join(' ').toLowerCase();
                const campo = UI_MANAGER.obtenerCampoChatEditable();
                const formulario = btn.closest('form');
                const esBotonEnvio = /send-message-button|enviar|send/.test(firmaBoton)
                    || (btn.getAttribute('type') === 'submit' && formulario && campo && formulario.contains(campo));
                if (esBotonEnvio) registrarEnvioAgente(campo);
            }
        }, true);

        setTimeout(() => {
            STATE.sistemaCargadoCompletamente = true;
            CRM_OBSERVER.escanear();
        }, 4000);

        const actualizarCronometros = () => {
            const huboCambios = MOTOR_CRONOMETROS_V2.tick();
            if (huboCambios) STATE.guardarEnDisco();
            COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio', 'historial', 'rendimiento');
        };

        setInterval(actualizarCronometros, 1000);

        // Detecta exclusivamente la apertura y cierre de pestañas aunque el CRM
        // no produzca una mutación observable o la VPN vuelva a conectarse.
        setInterval(() => CRM_OBSERVER.escanear(), 750);

        // El historial es exclusivamente local y conserva solo los últimos 7 días.
        setInterval(() => HISTORIAL_LOCAL.limpiarVencidos().then(() => STATE.refrescarHistorialLocal()), 30 * 60 * 1000);

        // Mantiene el acceso de emergencia aunque el CRM reconstruya su interfaz.
        setInterval(() => UI_MANAGER.asegurarUIEmergencia(), 1500);
        window.addEventListener('online', () => {
            UI_MANAGER.actualizarBotonEmergencia();
            NUBE_COMPARTIDA.cargarNoticia();
            ACTUALIZADOR_SUITE.comprobar(false);
        });
        window.addEventListener('offline', () => {
            STATE.guardarHistorialEmergencia();
            UI_MANAGER.actualizarBotonEmergencia();
        });

        // Volver a la pestaña solo refresca la vista. No añade segundos acumulados
        // ni ejecuta un tick adicional sobre los chats.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                COLA_VISUAL.solicitar('reloj', 'panel', 'pestanas', 'respuestas', 'inicio', 'historial', 'rendimiento');
            }
        });

        window.addEventListener('beforeunload', () => {
            Object.values(STATE.memoriaChats || {}).forEach(chat => {
                if (!chat?.finalizada) {
                    chat.interrumpida = true;
                    chat.resultado = chat.resultado || 'INTERRUMPIDA';
                    STATE.guardarRegistroHistorial(chat, { estadoInteraccion: 'INTERRUMPIDA' });
                }
            });
            STATE.guardarEnDisco();
            STATE.guardarHistorialEmergencia();
        });
    }

    let inicioSolicitado = false;
    const iniciar = () => {
        if (inicioSolicitado) return;
        inicioSolicitado = true;
        if (MODO_VENTANA_AUTH) return AUTH_MANAGER.inicializarVentanaExterna();
        if (ES_CRM) return inicializarSuite();
    };
    if (MODO_VENTANA_AUTH) iniciar();
    else if (document.body) iniciar();
    else {
        const observadorArranque = new MutationObserver(() => {
            if (!document.body) return;
            observadorArranque.disconnect();
            iniciar();
        });
        observadorArranque.observe(document.documentElement, { childList:true, subtree:true });
        window.addEventListener('DOMContentLoaded', iniciar, { once:true });
    }
})();
