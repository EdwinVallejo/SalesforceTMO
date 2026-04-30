// =============================================================
// CONTENT_SCRIPT.JS
// Inyecta la interfaz de usuario en Salesforce, incluyendo un modal
// para la captura de datos de bloqueo (Usuario, Equipo, Días),
// y guarda los últimos datos usados en chrome.storage.local.
// =============================================================

// --- 1. Constantes y Configuración ---

const UI_CONTAINER_ID = 'blocking-ext-ui-container';
const MODAL_ID = 'blocking-ext-modal';
const API_ACTION = "API_FETCH";
const LAST_BLOCK_DATA_KEY = 'lastBlockData'; // Clave para chrome.storage
const UI_FONT_FAMILY = "'Salesforce Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'";

// Valores por defecto iniciales (se sobrescribirán con el almacenamiento)
let USER_DATA = {
    usuario_nombre: "Agente Canvas", 
    equipo: "TMO",
    usuario_correo: "",
    pin: ""
};
let DEFAULT_BLOCK_DAYS = 20; // Bloqueo por defecto de 20 días


function injectStyles() {
    if (document.getElementById('blocking-ext-styles')) return;
    const style = document.createElement('style');
    style.id = 'blocking-ext-styles';
    style.textContent = `
        #${UI_CONTAINER_ID}, #${MODAL_ID} {
            font-family: ${UI_FONT_FAMILY} !important;
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            color: #16325c; /* Color de texto estándar de Salesforce */
        }
        #${UI_CONTAINER_ID} button, #${MODAL_ID} button, #${MODAL_ID} input {
            font-family: ${UI_FONT_FAMILY} !important;
        }
        #${UI_CONTAINER_ID}-panel h3, #${MODAL_ID} h4 {
            font-weight: 700 !important;
        }
    `;
    document.head.appendChild(style);
}


function getClientIdFromUrl() {
    const url = window.location.href;
    const match = url.match(/\/Account\/([a-zA-Z0-9]+)\/view/);
    if (match && match[1]) {
        console.log(`Blocking Ext: ID Cuenta encontrado: ${match[1]}`);
        return match[1];
    }
    console.log("Blocking Ext: No se encontró Account ID en la URL.");
    return null;
}

/**
 * Envía un mensaje al Service Worker para realizar una llamada a la API.
 */
function sendMessageToServiceWorker(urlSegment, method, data = null) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            action: API_ACTION,
            url: urlSegment,
            method: method,
            data: data
        }, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error("Error de comunicación con Service Worker: " + chrome.runtime.lastError.message));
                return;
            }
            resolve(response);
        });
    });
}

// --- 3. Gestión de Almacenamiento Local (chrome.storage) ---

/**
 * Carga los últimos datos guardados del almacenamiento local.
 */
async function loadSavedData() {
    return new Promise((resolve) => {
        chrome.storage.local.get(LAST_BLOCK_DATA_KEY, (result) => {
            const savedData = result[LAST_BLOCK_DATA_KEY];
            if (savedData) {
                console.log("Blocking Ext: Datos guardados cargados.", savedData);
                USER_DATA.usuario_nombre = savedData.usuario_nombre || USER_DATA.usuario_nombre;
                USER_DATA.equipo = savedData.equipo || USER_DATA.equipo;
                USER_DATA.usuario_correo = savedData.usuario_correo || "";
                USER_DATA.pin = savedData.pin || "";
                DEFAULT_BLOCK_DAYS = savedData.blockDays || DEFAULT_BLOCK_DAYS;
            } else {
                console.log("Blocking Ext: No hay datos guardados previamente.");
            }
            resolve();
        });
    });
}

/**
 * Guarda la última información de bloqueo utilizada.
 */
function saveLastBlockData(usuario_nombre, equipo, blockDays, usuario_correo = "", pin = "") {
    const dataToSave = {
        usuario_nombre: usuario_nombre,
        equipo: equipo,
        blockDays: blockDays,
        usuario_correo: usuario_correo,
        pin: pin
    };
    chrome.storage.local.set({ [LAST_BLOCK_DATA_KEY]: dataToSave }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error al guardar datos en chrome.storage:", chrome.runtime.lastError);
        } else {
            console.log("Blocking Ext: Datos de bloqueo guardados exitosamente.");
        }
    });
}

// --- 4. Componentes de UI ---

function createStyledInput(id, placeholder, defaultValue, type = 'text') {
    const div = document.createElement('div');
    div.style.display = 'flex'; 
    div.style.alignItems = 'center';
    div.style.marginBottom = '12px'; 
    div.style.border = '1px solid #ccc';
    div.style.borderRadius = '5px';
    div.style.backgroundColor = '#f9f9f9'; 

    const labelSpan = document.createElement('span');
    labelSpan.textContent = placeholder + ':';
    labelSpan.style.padding = '8px 7px';
    labelSpan.style.fontSize = '12px';
    labelSpan.style.color = '#555';
    labelSpan.style.fontWeight = 'bold';
    labelSpan.style.minWidth = '120px'; 
    labelSpan.style.backgroundColor = '#e9e9e9'; 
    labelSpan.style.borderRight = '1px solid #ccc';
    labelSpan.style.borderRadius = '5px 0 0 5px';
    
    const input = document.createElement('input');
    input.type = type; 
    input.id = id;
    input.value = defaultValue;
    input.style.flexGrow = '1'; 
    input.style.padding = '8px 7px';
    input.style.border = 'none'; 
    input.style.fontSize = '14px';
    input.style.backgroundColor = 'transparent'; 
    input.style.textAlign = (type === 'number') ? 'right' : 'left'; 

    div.appendChild(labelSpan);
    div.appendChild(input);
    return div;
}

function getOrCreateContainer() {
    let container = document.getElementById(UI_CONTAINER_ID);
    if (container) return container;

    injectStyles(); // Aseguramos que los estilos existan al crear el contenedor

    container = document.createElement('div');
    container.id = UI_CONTAINER_ID;
    container.style.position = 'fixed';
    container.style.top = '10px'; 
    container.style.left = '10px'; 
    container.style.zIndex = '99999'; 
    container.style.maxWidth = '300px'; 

    const anchorButton = document.createElement('button');
    anchorButton.id = `${UI_CONTAINER_ID}-anchor`;
    anchorButton.textContent = '🔒'; 
    anchorButton.style.padding = '5px 8px'; 
    anchorButton.style.borderRadius = '4px'; 
    anchorButton.style.backgroundColor = '#226B86'; 
    anchorButton.style.color = 'white';
    anchorButton.style.border = 'none';
    anchorButton.style.cursor = 'pointer';
    anchorButton.style.position = 'absolute'; 
    anchorButton.style.left = '0'; 
    anchorButton.style.top = '5px'; 

    anchorButton.onclick = () => {
        const panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
        if (panel) {
            const isVisible = panel.style.left === '0px';
            panel.style.left = isVisible ? '-320px' : '0px';
            anchorButton.textContent = isVisible ? '🔒' : '→'; 
        }
    };

    container.appendChild(anchorButton);
    document.body.appendChild(container);
    return container;
}

// --- 5. Lógica de Modal (Inyección y Contenido) ---

/**
 * Crea e inyecta el modal de entrada de datos.
 */
function createModal(clienteId) {
    let modal = document.getElementById(MODAL_ID);
    if (modal) {
        // Si el modal ya existe, solo actualizamos los valores de los inputs
        document.getElementById(`${MODAL_ID}-user`).value = USER_DATA.usuario_nombre;
        document.getElementById(`${MODAL_ID}-team`).value = USER_DATA.equipo;
        document.getElementById(`${MODAL_ID}-days`).value = DEFAULT_BLOCK_DAYS;
        modal.style.display = 'flex';
        return;
    }

    // --- 5.1. Backdrop (Fondo Oscuro) ---
    modal = document.createElement('div');
    modal.id = MODAL_ID;
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    modal.style.zIndex = '100000';
    modal.style.display = 'flex';
    modal.style.justifyContent = 'center';
    modal.style.alignItems = 'center';
    modal.style.fontFamily = 'Arial, sans-serif';

    // --- 5.2. Dialog (Contenido del Modal) ---
    const dialog = document.createElement('div');
    dialog.style.backgroundColor = 'white';
    dialog.style.padding = '25px';
    dialog.style.borderRadius = '10px';
    dialog.style.width = '350px';
    dialog.style.boxShadow = '0 8px 16px rgba(0, 0, 0, 0.3)';

    // 5.2.1. Título y Botón de Cerrar
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '20px';
    
    const title = document.createElement('h4');
    title.textContent = '🔒 Duración del Bloqueo';
    title.style.margin = '0';
    title.style.color = '#061C3F';
    title.style.fontSize = '18px';

    const closeButton = document.createElement('button');
    closeButton.textContent = '✕';
    closeButton.style.background = 'none';
    closeButton.style.border = 'none';
    closeButton.style.fontSize = '18px';
    closeButton.style.cursor = 'pointer';
    closeButton.style.color = '#555';
    closeButton.onclick = closeModal;

    header.appendChild(title);
    header.appendChild(closeButton);
    dialog.appendChild(header);

    // 5.2.2. Input de Días de Bloqueo
    const inputDays = createStyledInput(
        `${MODAL_ID}-days`, 
        'Días de bloqueo', 
        DEFAULT_BLOCK_DAYS,
        'number'
    );
    
    // Configuración específica para el input de días
    const daysInput = inputDays.querySelector('input');
    daysInput.min = 1;
    daysInput.max = 365;
    
    dialog.appendChild(inputDays);

    // 5.2.3. Área de Error y Botón de Acción
    const errorDiv = document.createElement('div');
    errorDiv.id = `${MODAL_ID}-error`;
    errorDiv.style.color = '#c93838'; 
    errorDiv.style.fontSize = '12px';
    errorDiv.style.marginBottom = '15px';
    dialog.appendChild(errorDiv);

    const lockButton = document.createElement('button');
    lockButton.textContent = 'Confirmar y Bloquear Cuenta';
    lockButton.style.padding = '12px 15px';
    lockButton.style.borderRadius = '5px';
    lockButton.style.fontWeight = 'bold';
    lockButton.style.cursor = 'pointer';
    lockButton.style.border = 'none';
    lockButton.style.width = '100%';
    lockButton.style.backgroundColor = '#187c34'; 
    lockButton.style.color = 'white';
    lockButton.style.textTransform = 'uppercase';
    lockButton.onclick = () => handleLock(clienteId);

    dialog.appendChild(lockButton);
    modal.appendChild(dialog);
    document.body.appendChild(modal);

    // Centrar y mostrar
    modal.style.display = 'flex';
}

/**
 * Cierra y oculta el modal.
 */
function closeModal() {
    const modal = document.getElementById(MODAL_ID);
    if (modal) {
        modal.style.display = 'none';
        const errorDiv = document.getElementById(`${MODAL_ID}-error`);
        if (errorDiv) errorDiv.textContent = '';
    }
}

// --- 6. Lógica de UI y Renderizado del Panel Principal ---

/**
 * Renderiza el estado actual del bloqueo dentro del panel deslizable.
 * (Resto de la función renderUI permanece sin cambios)
 */
function renderUI(clienteId, bloqueo) {
    const container = getOrCreateContainer();
    let panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (panel) panel.remove();
    
    panel = document.createElement('div');
    panel.id = `${UI_CONTAINER_ID}-panel`;
    panel.style.width = '300px';
    panel.style.backgroundColor = 'white';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
    panel.style.padding = '15px';
    panel.style.position = 'fixed';
    panel.style.top = '35px'; 
    panel.style.left = '0px'; 
    panel.style.transition = 'left 0.3s ease-in-out'; 

    const title = document.createElement('h3');
    title.textContent = 'Bloqueo de Cuenta 🏢 ';
    title.style.margin = '0 0 10px 0';
    title.style.fontSize = '16px';
    title.style.color = '#061C3F';
    panel.appendChild(title);

    const actionButton = document.createElement('button');
    actionButton.style.padding = '10px';
    actionButton.style.borderRadius = '5px';
    actionButton.style.width = '100%';
    actionButton.style.cursor = 'pointer';
    actionButton.style.border = 'none';

    const statusDiv = document.createElement('div');
    statusDiv.style.marginTop = '15px';
    statusDiv.style.padding = '12px';
    statusDiv.style.borderRadius = '5px';
    statusDiv.style.fontSize = '12px';
    statusDiv.style.textAlign = 'center';
    
    if (bloqueo) {
        // --- CAMBIO AQUÍ: Formateo de Fecha Completa ---
        const expDate = new Date(bloqueo.tiempo_expiracion);
        const dateStr = expDate.toLocaleDateString(); // Ejemplo: 18/12/2025
        const timeStr = expDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); // Ejemplo: 14:30
        
        statusDiv.innerHTML = `<b>🔴 BLOQUEADO</b> por ${bloqueo.usuario_nombre} (${bloqueo.equipo}).<br>Expira el: <b>${dateStr}</b> a las <b>${timeStr}</b>`;
        
        actionButton.textContent = '🔓 Liberar Cuenta';
        actionButton.style.backgroundColor = '#c93838'; 
        actionButton.style.color = 'white';
        statusDiv.style.backgroundColor = '#ffebe5'; 
        actionButton.onclick = () => handleUnlock(clienteId);
    } else {
        statusDiv.innerHTML = '<b>🟢 Cuenta Disponible</b>. Haz clic para realizar el bloqueo.';
        actionButton.textContent = '🔒 Bloquear Cuenta';
        actionButton.style.backgroundColor = '#187c34'; 
        actionButton.style.color = 'white';
        statusDiv.style.backgroundColor = '#e5fff3'; 
        actionButton.onclick = () => createModal(clienteId);
    }

    panel.appendChild(actionButton);
    panel.appendChild(statusDiv);
    container.appendChild(panel);
    
    const anchorButton = document.getElementById(`${UI_CONTAINER_ID}-anchor`);
    if (anchorButton) anchorButton.textContent = '→'; 
}

function renderLoading(message) {
    const container = getOrCreateContainer(); 
    let panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = `${UI_CONTAINER_ID}-panel`;
        panel.style.width = '300px';
        panel.style.backgroundColor = 'white';
        panel.style.borderRadius = '8px';
        panel.style.padding = '15px';
        panel.style.position = 'fixed';
        panel.style.top = '35px'; 
        panel.style.left = '0px'; 
        container.appendChild(panel);
    }
    panel.innerHTML = `<h3 style="margin: 0; font-size: 16px; color: #1e3760ff;">Bloqueo de Cuenta 🏢</h3><p style="text-align:center;">⏳ ${message}</p>`;
}

// --- 7. Handlers de Acción ---

async function handleLock(clienteId) {
    const blockDays = parseInt(document.getElementById(`${MODAL_ID}-days`).value.trim());
    
    if (isNaN(blockDays) || blockDays <= 0 || blockDays > 365) {
        const errorDiv = document.getElementById(`${MODAL_ID}-error`);
        if (errorDiv) errorDiv.textContent = "Error: La duración debe ser un número válido de días (1-365).";
        return;
    }

    // Usar los valores por defecto guardados en memoria
    const usuarioNombre = USER_DATA.usuario_nombre;
    const equipoNombre = USER_DATA.equipo;
    
    DEFAULT_BLOCK_DAYS = blockDays;
    saveLastBlockData(usuarioNombre, equipoNombre, blockDays);

    const duracionMinutos = blockDays * 24 * 60; 
    closeModal();
    renderLoading(`Bloqueando por ${blockDays} días...`);
    
    try {
        const response = await sendMessageToServiceWorker('base', 'POST', {
            cliente_id: clienteId,
            usuario_nombre: usuarioNombre,
            equipo: equipoNombre,
            duracion_minutos: duracionMinutos 
        });
        if (response.status === 201) {
            renderUI(clienteId, response.data.bloqueo);
            // Mostrar overlay de bloqueo
            showBlockOverlay(clienteId);
        }
    } catch (error) {
        console.error(error);
    }
}

// ... (renderLoading y renderError permanecen sin cambios significativos)

/**
 * Muestra un mensaje de carga dentro del panel principal.
 */
function renderLoading(message) {
    const container = getOrCreateContainer(); 
    let panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    
    if (!panel) {
        panel = document.createElement('div');
        panel.id = `${UI_CONTAINER_ID}-panel`;
        panel.style.width = '300px';
        panel.style.backgroundColor = 'white';
        panel.style.borderRadius = '8px';
        panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
        panel.style.padding = '15px';
        panel.style.position = 'fixed';
        panel.style.top = '35px'; 
        panel.style.left = '0px'; 
        panel.style.transition = 'left 0.3s ease-in-out';
        container.appendChild(panel);
    } else {
        panel.style.left = '0px';
    }
    
    panel.innerHTML = `
        <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1e3760ff;">Bloqueo de Cuenta 🏢</h3>
        <div style="padding: 20px; text-align: center; background-color: #f0f0f0; border-radius: 5px;">
            <p style="margin: 0; font-weight: bold; color: #555;">⏳ ${message}</p>
        </div>
    `;
    
    const anchor = document.getElementById(`${UI_CONTAINER_ID}-anchor`);
    if (anchor) anchor.textContent = '→'; 
}

/**
 * Muestra un overlay transparente sobre la cuenta bloqueada para evitar clics.
 */
function showBlockOverlay(clienteId) {
    const OVERLAY_ID = 'blocking-ext-overlay';
    
    // Verificar si ya existe
    let overlay = document.getElementById(OVERLAY_ID);
    if (overlay) return;
    
    // Crear el overlay
    overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.style.position = 'fixed';
    overlay.style.top = '160px'; // Ajuste para no tapar cabecera de Salesforce ni la URL
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = 'calc(100% - 160px)';
    overlay.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; // Totalmente transparente (o casi)
    overlay.style.zIndex = '99990'; 
    overlay.style.pointerEvents = 'auto'; 
    overlay.style.cursor = 'not-allowed';
    
    // Mensaje de bloqueo
    const messageDiv = document.createElement('div');
    messageDiv.style.position = 'absolute';
    messageDiv.style.top = '50%';
    messageDiv.style.left = '50%';
    messageDiv.style.transform = 'translate(-50%, -50%)';
    messageDiv.style.backgroundColor = 'rgba(201, 56, 56, 0.95)';
    messageDiv.style.color = 'white';
    messageDiv.style.padding = '20px 30px';
    messageDiv.style.borderRadius = '10px';
    messageDiv.style.fontSize = '18px';
    messageDiv.style.fontWeight = 'bold';
    messageDiv.style.textAlign = 'center';
    messageDiv.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.3)';
    messageDiv.innerHTML = '🔒 CUENTA BLOQUEADA<br><span style="font-size: 14px; font-weight: normal;">No puedes realizar acciones</span>';
    
    overlay.appendChild(messageDiv);
    document.body.appendChild(overlay);
    
    console.log("Blocking Ext: Overlay de bloqueo mostrado para cliente:", clienteId);
}

/**
 * Oculta el overlay de bloqueo.
 */
function hideBlockOverlay() {
    const overlay = document.getElementById('blocking-ext-overlay');
    if (overlay) {
        overlay.remove();
    }
}

/**
 * Muestra un mensaje de error dentro del panel principal.
 */
function renderError(message) {
    const container = getOrCreateContainer(); 
    let panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    if (!panel) {
        renderLoading("Error de inicialización."); // Asegura que el panel exista
        panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
    }
    showPanel(); 
    panel.innerHTML = `
        <h3 style="margin: 0 0 10px 0; font-size: 16px; color: #1e3760ff;">Bloqueo de Cuenta 🏢</h3>
        <div style="padding: 20px; text-align: center; background-color: #ffcccc; border-radius: 5px;">
            <p style="margin: 0; font-weight: bold; color: #cc0000;">🚨 ${message}</p>
        </div>
    `;
}

// --- 7. Handlers de Acción (Bloquear / Liberar) ---

async function handleLock(clienteId) {
    // 1. Leer y validar campos del MODAL
    const errorDiv = document.getElementById(`${MODAL_ID}-error`);
    if (errorDiv) errorDiv.textContent = ''; 

    const inputDays = document.getElementById(`${MODAL_ID}-days`);
    const blockDays = inputDays ? parseInt(inputDays.value.trim()) : 0;
    
    // Validación de campos
    if (isNaN(blockDays) || blockDays <= 0 || blockDays > 365) {
        if (errorDiv) errorDiv.textContent = "Error: La duración debe ser un número válido de días (1-365).";
        return;
    }

    // Usar los valores por defecto guardados en memoria
    const usuarioNombre = USER_DATA.usuario_nombre;
    const equipoNombre = USER_DATA.equipo;
    
    // Guardar los datos actuales en memoria (para el estado de la sesión)
    DEFAULT_BLOCK_DAYS = blockDays;
    saveLastBlockData(usuarioNombre, equipoNombre, blockDays, USER_DATA.usuario_correo, USER_DATA.pin);

    // Calcular duración en minutos
    const duracionMinutos = blockDays * 24 * 60; 

    // Cerrar el modal y mostrar el panel principal con el estado de carga
    closeModal();
    renderLoading(`Bloqueando por ${blockDays} días...`);
    
    // Calcular tiempos
    const timestamp_bloqueo = Date.now();
    const tiempo_expiracion = timestamp_bloqueo + (duracionMinutos * 60 * 1000);

    const payload = {
        cliente_id: clienteId,
        usuario_nombre: usuarioNombre,
        equipo: equipoNombre,
        usuario_correo: USER_DATA.usuario_correo,
        pin: USER_DATA.pin,
        timestamp_bloqueo: timestamp_bloqueo,
        tiempo_expiracion: tiempo_expiracion,
        duracion_minutos: duracionMinutos 
    };

    try {
        const response = await sendMessageToServiceWorker('base', 'POST', payload);
        
        if (response.status === 201) {
            console.log("Bloqueo creado exitosamente:", response.data.bloqueo);
            renderUI(clienteId, response.data.bloqueo);
            // Mostrar overlay de bloqueo
            showBlockOverlay(clienteId);
        } else if (response.status === 400) {
            console.error("Error de validación al bloquear:", response.data.message);
            renderError("Error de validación: " + response.data.message); 
        } else {
            console.error("Error al crear bloqueo. Status:", response.status, response.data);
            renderError("No se pudo crear el bloqueo.");
        }
    } catch (error) {
        console.error("Error de red o SW al bloquear:", error);
        renderError("Error de comunicación al bloquear.");
    }
}

/**
 * Maneja la acción de Liberar Cliente.
 * (Resto de la función handleUnlock permanece sin cambios)
 */
async function handleUnlock(clienteId) {
    renderLoading("Liberando...");

    try {
        const response = await sendMessageToServiceWorker(clienteId, 'DELETE');
        
        if (response.status === 204 || response.status === 404) {
            console.log("Bloqueo eliminado exitosamente.");
            renderUI(clienteId, null); 
            // Ocultar overlay de bloqueo
            hideBlockOverlay();
        } else {
            console.error("Error al eliminar bloqueo. Status:", response.status);
            renderError("No se pudo liberar el bloqueo.");
        }
    } catch (error) {
        console.error("Error de red o SW al liberar:", error);
        renderError("Error de comunicación al liberar.");
    }
}


// --- 8. Inicialización y Observador de URL ---

let currentClientId = null;
//let isExtensionActive = false;

/**
 * Función que se ejecuta al cargar la página o al navegar en la aplicación.
 */
async function initializeExtension() {
    const newClientId = getClientIdFromUrl();

    // Si no hay ID de cliente en la URL, limpiamos y salimos
    if (!newClientId) {
        currentClientId = null;
        const panel = document.getElementById(`${UI_CONTAINER_ID}-panel`);
        if (panel) panel.remove();
        const container = document.getElementById(UI_CONTAINER_ID);
        if (container) container.style.display = 'none';
        hideBlockOverlay(); // Asegurarse de quitar el bloqueo si salimos de una cuenta
        return;
    }

    // Si el ID es diferente al anterior, "reseteamos" la vista inmediatamente
    if (newClientId !== currentClientId) {
        currentClientId = newClientId;
        
        // Asegurar que el contenedor sea visible
        const container = getOrCreateContainer();
        container.style.display = 'block';
        
        // Cargar datos de usuario guardados
        await loadSavedData(); 
        
        // Mostrar carga inmediatamente para evitar ver datos del cliente anterior
        renderLoading("Actualizando cuenta...");

        try {
            const response = await sendMessageToServiceWorker(newClientId, 'GET');
            // Verificación extra: ¿seguimos en la misma cuenta después de la respuesta asíncrona?
            if (newClientId === getClientIdFromUrl()) {
                if (response.status === 200) {
                    renderUI(newClientId, response.data);
                    // Si hay bloqueo, mostrar overlay
                    showBlockOverlay(newClientId);
                } else {
                    renderUI(newClientId, null); 
                    hideBlockOverlay();
                }
            }
        } catch (error) {
            console.error("Error al inicializar Cuenta:", error);
            if (newClientId === getClientIdFromUrl()) {
                renderUI(newClientId, null);
            }
        }
    }
}

// Iniciar la extensión al cargar la página
initializeExtension();

// Observar cambios en la URL (para SPA como Salesforce Lightning)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        initializeExtension();
    }
}).observe(document, { subtree: true, childList: true });

// Sincronizar datos si cambian en el popup (Login)
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LAST_BLOCK_DATA_KEY]) {
        console.log("Blocking Ext: Datos de usuario actualizados desde almacenamiento.");
        loadSavedData();
    }
});