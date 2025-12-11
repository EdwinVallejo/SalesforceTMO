// =============================================================
// CONTENT_SCRIPT.JS
// Ejecutado en la página de Salesforce.
// =============================================================
console.log("Blocking Ext: 1. Script de contenido cargado."); // Debug 1: Indica que el navegador ha inyectado y está leyendo el script

// --- Funciones de Utilidad y Globales (Accesibles desde el HTML Inyectado) ---

function getClientIdFromUrl() {
    const matches = window.location.pathname.match(/\/lightning\/r\/Account\/([a-zA-Z0-9]{15,18})/);
    return matches ? matches[1] : null;
}

function getUserNameFromSession() {
    const userMenu = document.querySelector('button[title="User"]');
    if (userMenu) {
        const ariaLabel = userMenu.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.includes('User menu for')) {
            return ariaLabel.replace('User menu for ', '').trim();
        }
    }
    return "Usuario Desconocido"; 
}

// Inyección forzada en el body con posición fija
function injectStatusContainer() {
    let container = document.getElementById('blocking-status-container');
    if (container) return container;

    container = document.createElement('div');
    container.id = 'blocking-status-container';
    
    // Estilos Fijos para aparecer en la esquina superior derecha
    container.style.position = 'fixed';
    container.style.top = '70px'; 
    container.style.right = '20px';
    container.style.zIndex = '9999';
    container.style.width = '350px';
    container.style.padding = '10px';
    container.style.borderRadius = '4px';
    container.style.boxShadow = '0 3px 10px rgba(0,0,0,0.2)';
    container.style.fontWeight = 'bold';
    
    document.body.prepend(container);
    return container;
}

// -------------------------------------------------------------
// *IMPORTANTE: Definiciones de funciones de ACCIÓN y LÓGICA DE EVENTOS
// -------------------------------------------------------------

// Función para solicitar el bloqueo (muestra el prompt)
window.pedirBloqueo = function(clientId, userName) {
    // Usamos confirm() / prompt() como fallback simple, idealmente se usaría un modal UI
    const team = prompt(`Cliente libre. Usuario: ${userName}. \n\nIngresa tu Equipo o Área (Ej: QA, TMO):`);
    if (team) {
        window.createBlocking(clientId, userName, team);
    }
};

// Función para liberar el cliente (muestra el confirm)
window.liberarCliente = function(clientId, blockerName, currentUserName) {
    // Si otro usuario está bloqueando, pedimos confirmación adicional
    if (currentUserName !== blockerName) {
         if (!confirm(`ADVERTENCIA: Bloqueado por ${blockerName}. ¿Desea forzar la liberación?`)) return;
    } else if (!confirm("¿Confirmar liberación del cliente?")) {
        return;
    }
    window.deleteBlocking(clientId, currentUserName);
};

// --- Configuración de Event Listeners (Solución al fallo de click) ---

function setupButtonListeners(clientId, userName, blockerName) {
    // 1. Botón de Bloqueo (Cliente Libre)
    const blockButton = document.getElementById('block-client-button');
    if (blockButton) {
        // Aseguramos que el evento se adjunte directamente
        blockButton.addEventListener('click', () => window.pedirBloqueo(clientId, userName));
    }

    // 2. Botón de Liberación (Cliente Bloqueado)
    const releaseButton = document.getElementById('release-client-button');
    if (releaseButton) {
        // Aseguramos que el evento se adjunte directamente
        releaseButton.addEventListener('click', () => window.liberarCliente(clientId, blockerName, userName));
    }
}


// --- Lógica de Comunicación con el Service Worker (Proxy) ---

window.createBlocking = async function(clientId, userName, team) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (statusContainer) statusContainer.innerHTML = `<div style="color:#0070D2;">Bloqueando cliente (Comunicando con API)...</div>`;

    const bloqueoData = {
        cliente_id: clientId,
        usuario_nombre: userName,
        equipo: team,
        duracion_minutos: 120 
    };

    try {
        const response = await chrome.runtime.sendMessage({
            action: "API_FETCH",
            method: 'POST',
            url: 'base', 
            data: bloqueoData
        });
        
        // Verifica si la respuesta es 201 (Creado)
        if (response && response.status === 201) {
            console.log("Bloqueo exitoso. Status 201 recibido.");
            window.checkBlockingStatus(clientId, userName); 
        } else if (response) {
            // Maneja otros estados HTTP que no sean el esperado 201
            console.error(`Error al crear bloqueo. Status: ${response.status}`, response.data);
            
            // Intenta extraer un mensaje de error detallado de la respuesta de la API (si existe)
            const errorDetail = response.data && response.data.message ? response.data.message : 'Verifique los logs del Service Worker/Render.';

            statusContainer.innerHTML = `<div style="color:red; padding:5px;">Error ${response.status}: ${errorDetail}</div>`;
            setupButtonListeners(clientId, userName); // Adjuntar listeners de nuevo para reintentar
        } else {
             // Maneja si la respuesta del Service Worker fue null/undefined
            statusContainer.innerHTML = `<div style="color:red; padding:5px;">Error: Respuesta de Service Worker no válida.</div>`;
        }

    } catch (e) {
        console.error("Fallo al crear bloqueo:", e);
        // Nota: Usamos alert() aquí como fallback simple.
        alert("Error de comunicación con el Service Worker (POST)."); 
    }
};

window.deleteBlocking = async function(clientId, userName) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (statusContainer) statusContainer.innerHTML = `<div style="color:gray;">Liberando cliente...</div>`;

    try {
        const response = await chrome.runtime.sendMessage({
            action: "API_FETCH",
            method: 'DELETE',
            url: clientId, 
        });

        // 200: Éxito; 404: Ya estaba libre o se eliminó
        if (response && (response.status === 200 || response.status === 404)) {
            window.checkBlockingStatus(clientId, userName); 
        } else {
            statusContainer.innerHTML = `<div style="color:red; padding:5px;">Error ${response ? response.status : 'N/A'} al liberar cliente.</div>`;
            setupButtonListeners(clientId, userName); // Adjuntar listeners de nuevo para reintentar
        }

    } catch (e) {
        console.error("Fallo al liberar cliente:", e);
        alert("Error de comunicación con el Service Worker (DELETE).");
    }
};


// Chequea el estado actual del cliente (GET)
window.checkBlockingStatus = async function(clientId, userName) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (!statusContainer) return;

    statusContainer.innerHTML = `<div style="color: #0070D2;">⌛ Verificando estado de bloqueo...</div>`;
    statusContainer.style.backgroundColor = '#f0f0f0';

    try {
        const response = await chrome.runtime.sendMessage({
            action: "API_FETCH",
            method: 'GET',
            url: clientId, 
        });

        if (response && response.status === 200) {
            // Caso 1: CLIENTE BLOQUEADO (Servidor responde 200)
            const bloqueo = response.data;
            const expirationTime = new Date(bloqueo.tiempo_expiracion).toLocaleTimeString();
            
            // Lógica de visualización para BLOQUEADO (Rojo)
            statusContainer.style.backgroundColor = '#ffeaea'; 
            statusContainer.style.borderLeft = '4px solid #f75d59';

            statusContainer.innerHTML = `
                <div style="color: #cc0000; padding: 5px;">
                    🚨 **CLIENTE EN USO POR PRUEBAS**
                    <hr style="margin: 5px 0; border-color: #f75d59;">
                    **Encargado:** <strong>${bloqueo.usuario_nombre}</strong> (${bloqueo.equipo})
                    <br>
                    *Se liberará automáticamente a las ${expirationTime}*
                    <button id="release-client-button"
                        style="margin-top: 8px; background-color: #cc0000; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                        Liberar
                    </button>
                </div>
            `;
            // IMPORTANTE: Adjuntar el listener DEBE hacerse después de que el elemento existe en el DOM
            setupButtonListeners(clientId, userName, bloqueo.usuario_nombre); 

        } else if (response && response.status === 404) {
            // Caso 2: CLIENTE LIBRE (Servidor responde 404)
            statusContainer.style.backgroundColor = '#e6ffe6'; 
            statusContainer.style.borderLeft = '4px solid #4CAF50';
            
            statusContainer.innerHTML = `
                <div style="color: #38761d; padding: 5px;">
                    ✅ **Cliente Libre.**
                    <button id="block-client-button"
                        style="margin-top: 8px; background-color: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                        Bloquear para Pruebas
                    </button>
                </div>
            `;
            // IMPORTANTE: Adjuntar el listener DEBE hacerse después de que el elemento existe en el DOM
            setupButtonListeners(clientId, userName); 

        } else {
            // Caso 3: Error Real (500, 400, o Service Worker falló)
            statusContainer.innerHTML = `<div style="color: red; padding: 5px;">Error ${response ? response.status : 'N/A'} desconocido. Revise la API y Service Worker.</div>`;
        }

    } catch (error) {
        console.error("Fallo la comunicación con el Service Worker:", error);
        statusContainer.innerHTML = `<div style="color: orange; padding: 5px;">⚠️ Error de comunicación. Reinicie la extensión.</div>`;
    }
}


// =============================================================
// INICIO DE LA EXTENSIÓN
// =============================================================

// Variable para rastrear la última URL procesada (ya no es estrictamente necesaria, pero la mantenemos)
let lastProcessedUrl = location.href; 
let observer = null;

function initializeExtension() {
    console.log("Blocking Ext: 4. Ejecutando initializeExtension."); // Debug 4: Inicio de la lógica principal
    const currentUrl = location.href;
    const clientId = getClientIdFromUrl();
    const userName = getUserNameFromSession();
    const statusContainer = document.getElementById('blocking-status-container'); 

    console.log("Blocking Ext: URL actual:", currentUrl, "| ID Cliente encontrado:", clientId); // Debug 5: Muestra la URL y el ID
    
    // **LÓGICA DE OPTIMIZACIÓN MEJORADA:**
    // Si la URL NO ha cambiado, y es una cuenta, y la caja ya existe, no hacemos nada.
    if (currentUrl === lastProcessedUrl && statusContainer && clientId) {
        console.log("Blocking Ext: Optimizando: URL no ha cambiado y ya está activa.");
        return; 
    }
    
    // Si la URL ha cambiado, actualizamos.
    lastProcessedUrl = currentUrl; 

    if (clientId) {
        console.log("Blocking Ext: A) Es página de Cuenta. Inyectando caja de estado."); // Debug 6: Ruta de Cuenta
        // Caso A: Es una página de Cuenta. Inyectar y verificar estado.
        injectStatusContainer();
        window.checkBlockingStatus(clientId, userName); 
    } else {
        console.log("Blocking Ext: B) No es página de Cuenta. Eliminando caja de estado (si existe)."); // Debug 7: Ruta de No-Cuenta
        // Caso B: NO es una página de Cuenta (Caso, Contacto, etc.). Eliminar el contenedor.
        if (statusContainer) {
            statusContainer.remove(); 
        }
    }
}

/**
 * Configura un MutationObserver para detectar cambios en el DOM (navegación SPA).
 * Este callback se dispara en CADA cambio importante del DOM.
 */
function setupMutationObserver() {
    console.log("Blocking Ext: 2. Iniciando setupMutationObserver."); // Debug 2: Inicio de la configuración del Observer
    // Si ya existe un observador, lo desconectamos
    if (observer) {
        observer.disconnect();
    }

    const targetNode = document.body; 
    // Configuramos para escuchar la lista de hijos (childList) y todo el subárbol (subtree)
    // Esto asegura que detecte cuando el contenido principal de Salesforce se reemplaza.
    const config = { childList: true, subtree: true }; 

    // Usamos el callback para forzar la inicialización después de un pequeño retraso.
    const callback = function() {
        // El setTimeout es CRUCIAL en Salesforce. Garantiza que la URL tenga tiempo de actualizarse
        // antes de que getClientIdFromUrl() la compruebe.
        setTimeout(initializeExtension, 100); 
    };

    observer = new MutationObserver(callback);
    observer.observe(targetNode, config);
    console.log("Blocking Ext: 3. MutationObserver en escucha en el BODY."); // Debug 3: Observer activo
    
    // Ejecutamos la inicialización inmediatamente después de establecer el observador
    initializeExtension(); 
}


// =============================================================
// INICIALIZACIÓN ROBUSTA
// =============================================================

// Iniciar la extensión de forma robusta.
// 1. Usa DOMContentLoaded para la carga inicial (Hard Reload), que es más fiable que un setTimeout fijo.
// 2. Si el DOM ya está listo (script inyectado tarde), se ejecuta inmediatamente.
if (document.readyState === 'loading') {
    console.log("Blocking Ext: 0. Esperando DOMContentLoaded..."); // Debug 8: Esperando evento
    document.addEventListener('DOMContentLoaded', setupMutationObserver);
} else {
    console.log("Blocking Ext: 0. DOM ya cargado. Ejecutando inmediatamente."); // Debug 9: Ejecución inmediata
    setupMutationObserver();
}