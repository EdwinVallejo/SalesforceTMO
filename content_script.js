// =============================================================
// CONTENT_SCRIPT.JS - SISTEMA DE BLOQUEO AVANZADO
// =============================================================

const UI_CONTAINER_ID = 'blocking-ext-ui-container';
const API_ACTION = "API_FETCH";
const LAST_BLOCK_DATA_KEY = 'lastBlockData';
const UI_FONT_FAMILY = "'Salesforce Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TEMP_ACCESS_DURATION_MS = 10000; // 10 segundos parametrizables

let USER_DATA = { usuario_nombre: "", equipo: "", usuario_correo: "", pin: "" };
let DEFAULT_BLOCK_DAYS = 20;
let tempAccessTimer = null;

// --- 1. Estilos Premium ---

function injectStyles() {
    if (document.getElementById('blocking-ext-styles')) return;
    const style = document.createElement('style');
    style.id = 'blocking-ext-styles';
    style.textContent = `
        #${UI_CONTAINER_ID} {
            font-family: ${UI_FONT_FAMILY} !important;
            -webkit-font-smoothing: antialiased;
            color: #16325c;
        }
        #${UI_CONTAINER_ID}-panel h3 {
            font-weight: 700 !important;
            border-bottom: 2px solid #0176d3;
            padding-bottom: 8px;
            margin-bottom: 12px;
            color: #061C3F;
        }
        .blocking-ext-input-group {
            display: flex;
            background: #f3f3f3;
            border: 1px solid #dddbda;
            border-radius: 4px;
            overflow: hidden;
            margin-bottom: 10px;
        }
        .blocking-ext-input-group label {
            background: #eef4ff;
            padding: 8px 12px;
            font-size: 12px;
            font-weight: bold;
            color: #0176d3;
            border-right: 1px solid #dddbda;
            min-width: 80px;
        }
        .blocking-ext-input-group input {
            border: none;
            padding: 8px;
            flex: 1;
            outline: none;
            font-size: 14px;
        }
        .blocking-ext-overlay-card {
            background: white;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 15px 35px rgba(0,0,0,0.4);
            max-width: 420px;
            width: 90%;
            text-align: center;
            border-top: 5px solid #c23934;
        }
        .blocking-ext-overlay-info {
            background: #fafffa;
            border: 1px solid #c2393433;
            border-radius: 8px;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
        }
        .blocking-ext-overlay-info p { margin: 5px 0; font-size: 13px; color: #333; }
        .blocking-ext-overlay-info b { color: #16325c; width: 70px; display: inline-block; }
    `;
    document.head.appendChild(style);
}

// --- 2. Utilidades y API ---

function getClientIdFromUrl() {
    const match = window.location.href.match(/\/Account\/([a-zA-Z0-9]+)\/view/);
    return match ? match[1] : null;
}

function sendMessageToServiceWorker(urlSegment, method, data = null) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: API_ACTION, url: urlSegment, method, data }, (res) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(res);
        });
    });
}

async function loadSavedData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(LAST_BLOCK_DATA_KEY, (result) => {
            if (result[LAST_BLOCK_DATA_KEY]) {
                USER_DATA = { ...USER_DATA, ...result[LAST_BLOCK_DATA_KEY] };
                DEFAULT_BLOCK_DAYS = result[LAST_BLOCK_DATA_KEY].blockDays || 20;
            }
            resolve();
        });
    });
}

function saveLastBlockData(usuario_nombre, equipo, blockDays, usuario_correo, pin) {
    chrome.storage.local.set({ [LAST_BLOCK_DATA_KEY]: { usuario_nombre, equipo, blockDays, usuario_correo, pin } });
}

// --- 3. UI y Overlay ---

function getOrCreateContainer() {
    let container = document.getElementById(UI_CONTAINER_ID);
    if (container) return container;
    injectStyles();
    container = document.createElement('div');
    container.id = UI_CONTAINER_ID;
    container.style.cssText = 'position:fixed; top:10px; left:10px; z-index:99999; max-width:300px;';
    
    const anchor = document.createElement('button');
    anchor.id = `${UI_CONTAINER_ID}-anchor`;
    anchor.textContent = '🔒';
    anchor.style.cssText = 'padding:5px 8px; border-radius:4px; background:#226B86; color:white; border:none; cursor:pointer; position:absolute; left:0; top:5px;';
    anchor.onclick = () => {
        const panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
        const isVisible = panel.style.left === '0px';
        panel.style.left = isVisible ? '-320px' : '0px';
        anchor.textContent = isVisible ? '🔒' : '→';
    };
    container.appendChild(anchor);
    document.body.appendChild(container);
    return container;
}

function renderUI(clienteId, bloqueo) {
    const container = getOrCreateContainer();
    let panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (panel) panel.remove();
    
    panel = document.createElement('div');
    panel.id = `${UI_CONTAINER_ID}-panel`;
    panel.style.cssText = 'width:300px; background:white; border-radius:8px; boxShadow:0 4px 12px rgba(0,0,0,0.2); padding:15px; position:fixed; top:35px; left:0; transition:left 0.3s ease;';

    const actionButton = document.createElement('button');
    actionButton.style.cssText = 'padding:10px; border-radius:5px; width:100%; cursor:pointer; border:none; font-weight:bold;';

    const statusDiv = document.createElement('div');
    statusDiv.style.cssText = 'margin-top:15px; padding:12px; border-radius:5px; font-size:12px; textAlign:center;';

    if (bloqueo) {
        const expDate = new Date(bloqueo.tiempo_expiracion);
        statusDiv.innerHTML = `<b>🔴 BLOQUEADO</b> por ${bloqueo.usuario_nombre}.<br>Expira: ${expDate.toLocaleString()}`;
        actionButton.textContent = '🔓 Liberar Cuenta';
        actionButton.style.background = '#c93838'; actionButton.style.color = 'white';
        statusDiv.style.background = '#ffebe5';
        actionButton.onclick = () => handleUnlock(clienteId);
    } else {
        panel.innerHTML = `
            <h3>Bloqueo de Cuenta 🏢</h3>
            <div style="margin-bottom:15px;">
                <p style="font-size:11px; color:#666; margin-bottom:5px;">Duración del bloqueo:</p>
                <div class="blocking-ext-input-group">
                    <label>Días</label>
                    <input type="number" id="direct-days" value="${DEFAULT_BLOCK_DAYS}" min="1" max="365">
                </div>
            </div>
        `;
        actionButton.textContent = '🔒 Bloquear Cuenta';
        actionButton.style.background = '#187c34'; actionButton.style.color = 'white';
        statusDiv.innerHTML = '<b>🟢 Disponible</b>';
        statusDiv.style.background = '#e5fff3';
        actionButton.onclick = () => handleLockDirect(clienteId, parseInt(document.getElementById('direct-days').value));
    }

    panel.appendChild(actionButton);
    panel.appendChild(statusDiv);
    container.appendChild(panel);
}

function showBlockOverlay(clienteId, bloqueo) {
    if (document.getElementById('blocking-ext-overlay')) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'blocking-ext-overlay';
    overlay.style.cssText = 'position:fixed; top:160px; left:0; width:100%; height:calc(100% - 160px); background:rgba(0,0,0,0.5); backdrop-filter:blur(4px); z-index:99990; display:flex; justify-content:center; align-items:center; pointer-events:auto;';
    
    overlay.innerHTML = `
        <div class="blocking-ext-overlay-card">
            <h2 style="margin:0; color:#c23934; font-size:22px;">🔒 Cuenta Bloqueada</h2>
            <div class="blocking-ext-overlay-info">
                <p><b>Usuario:</b> ${bloqueo.usuario_nombre}</p>
                <p><b>Correo:</b> ${bloqueo.usuario_correo}</p>
                <p><b>Área:</b> ${bloqueo.equipo}</p>
                <p><b>Expira:</b> ${new Date(bloqueo.tiempo_expiracion).toLocaleDateString()}</p>
            </div>
            <div style="border-top:1px solid #eee; padding-top:15px;">
                <p style="font-size:12px; font-weight:700; margin-bottom:10px;">Acceso Temporal</p>
                <div style="display:flex; gap:8px; justify-content:center;">
                    <input type="password" id="ov-pin" placeholder="PIN" style="width:70px; padding:8px; border:1px solid #ddd; border-radius:4px; text-align:center;">
                    <button id="ov-btn" style="padding:8px 15px; background:#0176d3; color:white; border:none; border-radius:4px; cursor:pointer; font-weight:700;">Entrar (10s)</button>
                </div>
                <p id="ov-err" style="color:#c23934; font-size:10px; margin-top:5px; display:none;">PIN Incorrecto</p>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#ov-btn').onclick = () => {
        const pin = overlay.querySelector('#ov-pin').value;
        if (pin === bloqueo.pin) handleTempAccess(clienteId, bloqueo);
        else {
            overlay.querySelector('#ov-err').style.display = 'block';
            setTimeout(() => overlay.querySelector('#ov-err').style.display = 'none', 2000);
        }
    };
}

function hideBlockOverlay() {
    const ov = document.getElementById('blocking-ext-overlay'); if (ov) ov.remove();
    const nt = document.getElementById('blocking-ext-temp-notify'); if (nt) nt.remove();
}

function handleTempAccess(id, b) {
    hideBlockOverlay();
    if (tempAccessTimer) clearTimeout(tempAccessTimer);
    
    const nt = document.createElement('div');
    nt.id = 'blocking-ext-temp-notify';
    nt.style.cssText = 'position:fixed; bottom:20px; right:20px; background:#2e844a; color:white; padding:10px 20px; border-radius:8px; z-index:100001; font-weight:700;';
    nt.textContent = '⏱️ Acceso activo (10s)';
    document.body.appendChild(nt);

    tempAccessTimer = setTimeout(() => {
        nt.remove();
        if (getClientIdFromUrl() === id) showBlockOverlay(id, b);
    }, TEMP_ACCESS_DURATION_MS);
}

// --- 4. Handlers ---

async function handleLockDirect(id, days) {
    if (!USER_DATA.usuario_correo) return alert("🚨 Debes iniciar sesión en la extensión.");
    if (!days || days < 1) return alert("Días inválidos.");

    renderLoading(`Bloqueando...`);
    const ts = Date.now();
    const exp = ts + (days * 24 * 60 * 60 * 1000);
    const payload = {
        cliente_id: id, usuario_nombre: USER_DATA.usuario_nombre, equipo: USER_DATA.equipo,
        usuario_correo: USER_DATA.usuario_correo, pin: USER_DATA.pin,
        timestamp_bloqueo: ts, tiempo_expiracion: exp, duracion_minutos: days * 1440
    };

    try {
        const res = await sendMessageToServiceWorker('base', 'POST', payload);
        if (res.status === 201) { renderUI(id, res.data.bloqueo); hideBlockOverlay(); }
        else renderError("Error al bloquear.");
    } catch (e) { renderError("Error de conexión."); }
}

async function handleUnlock(id) {
    renderLoading("Liberando...");
    try {
        const res = await sendMessageToServiceWorker(id, 'DELETE');
        if (res.status === 204 || res.status === 404) { renderUI(id, null); hideBlockOverlay(); }
        else renderError("Error al liberar.");
    } catch (e) { renderError("Error de conexión."); }
}

function renderLoading(msg) {
    const p = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (p) p.innerHTML = `<h3>Bloqueo de Cuenta 🏢</h3><p style="text-align:center; padding:20px;">⏳ ${msg}</p>`;
}

function renderError(msg) {
    const p = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (p) p.innerHTML = `<h3>Bloqueo de Cuenta 🏢</h3><p style="text-align:center; padding:20px; color:#c23934;">🚨 ${msg}</p>`;
}

// --- 5. Inicialización ---

let currentId = null;
async function init() {
    const id = getClientIdFromUrl();
    if (!id) {
        currentId = null;
        const p = document.getElementById(`${UI_CONTAINER_ID}-panel`); if (p) p.remove();
        const c = document.getElementById(UI_CONTAINER_ID); if (c) c.style.display = 'none';
        hideBlockOverlay();
        return;
    }

    if (id !== currentId) {
        currentId = id;
        getOrCreateContainer().style.display = 'block';
        await loadSavedData();
        renderLoading("Cargando...");
        try {
            const res = await sendMessageToServiceWorker(id, 'GET');
            if (id === getClientIdFromUrl()) {
                const b = (res.status === 200) ? res.data : null;
                renderUI(id, b);
                if (b && b.usuario_correo !== USER_DATA.usuario_correo) showBlockOverlay(id, b);
                else hideBlockOverlay();
            }
        } catch (e) { renderUI(id, null); }
    }
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LAST_BLOCK_DATA_KEY]) loadSavedData().then(() => {
        // Forzar re-verificación si el usuario cambió
        currentId = null; init();
    });
});

init();
let lastUrl = location.href;
new MutationObserver(() => {
    if (location.href !== lastUrl) { lastUrl = location.href; init(); }
}).observe(document, { subtree: true, childList: true });