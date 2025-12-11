// =============================================================
// CONTENT_SCRIPT.JS
// Ejecutado en el contexto de la página de Salesforce (Lightning)
// Delega todas las llamadas FETCH al Service Worker (background.js)
// para evitar la violación de Content Security Policy (CSP).
// =============================================================

// --- Funciones de Utilidad ---

// Obtiene el ID del cliente (Account) de la URL
function getClientIdFromUrl() {
    // Patrón para capturar el ID de 15 o 18 caracteres del URL del registro (Account)
    const matches = window.location.pathname.match(/\/lightning\/r\/Account\/([a-zA-Z0-9]{15,18})/);
    return matches ? matches[1] : null;
}

// Obtiene el nombre del usuario logueado (Usado para el campo 'usuario_nombre')
function getUserNameFromSession() {
    // Busca el elemento del menú de usuario que contiene el nombre completo
    const userMenu = document.querySelector('button[title="User"]');
    if (userMenu) {
        const ariaLabel = userMenu.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.includes('User menu for')) {
            return ariaLabel.replace('User menu for ', '').trim();
        }
    }
    // Fallback: Si el selector de menú falla
    return "Usuario Desconocido"; 
}

// Inyecta el contenedor de estado en un punto estable del DOM
function injectStatusContainer(targetElement) {
    let container = document.getElementById('blocking-status-container');
    if (container) return container; // Ya existe

    container = document.createElement('div');
    container.id = 'blocking-status-container';
    container.style.marginTop = '15px'; 
    container.style.padding = '10px';
    container.style.borderRadius = '4px';
    container.style.fontWeight = 'bold';
    container.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
    
    // Inyectamos el contenedor al inicio del target (target.prepend)
    targetElement.prepend(container);
    return container;
}

// Función que pide datos al usuario y llama al POST
function pedirBloqueo(clientId, userName) {
    const team = prompt(`Cliente libre. Usuario: ${userName}. \n\nIngresa tu Equipo o Área (Ej: QA, TMO):`);
    if (team) {
        createBlocking(clientId, userName, team);
    }
}

// Función que pide confirmación de liberación y llama al DELETE
function liberarCliente(clientId, blockerName, currentUserName) {
    if (currentUserName !== blockerName) {
         if (!confirm(`ADVERTENCIA: Bloqueado por ${blockerName}. ¿Desea forzar la liberación?`)) return;
    } else if (!confirm("¿Confirmar liberación del cliente?")) {
        return;
    }
    
    deleteBlocking(clientId, currentUserName);
}

// --- Lógica de Comunicación con el Service Worker (Proxy) ---

// Realiza el POST para bloquear el cliente
async function createBlocking(clientId, userName, team) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (statusContainer) statusContainer.innerHTML = `<div style="color:#0070D2;">Bloqueando cliente (Comunicando con API)...</div>`;

    const bloqueoData = {
        cliente_id: clientId,
        usuario_nombre: userName,
        equipo: team,
        duracion_minutos: 120 // Bloqueo predeterminado por 2 horas
    };

    try {
        // Llama al Service Worker (background.js) para hacer el POST
        const response = await chrome.runtime.sendMessage({
            action: "API_FETCH",
            method: 'POST',
            url: 'base', 
            data: bloqueoData
        });
        
        if (response && response.status === 201) {
            checkBlockingStatus(clientId, userName); // Refresca el estado
        } else {
            statusContainer.innerHTML = `<div style="color:red;">Error ${response ? response.status : 'N/A'} al crear bloqueo.</div>`;
        }
        if (response.status === 200) {
            // Caso 1: Cliente BLOQUEADO (El servidor encontró un registro)
            const bloqueo = response.data;
            // ... (código para mostrar el mensaje rojo, el botón Liberar, etc.)

        } else if (response.status === 404) {
            // Caso 2: Cliente LIBRE (El servidor NO encontró un registro, que es el 404 esperado)
            statusContainer.style.backgroundColor = '#e6ffe6'; // Verde claro
            statusContainer.style.borderLeft = '4px solid #4CAF50';
            
            statusContainer.innerHTML = `
                <div style="color: #38761d; padding: 5px;">
                    ✅ **Cliente Libre.**
                    <button onclick="pedirBloqueo('${clientId}', '${userName}')" 
                        style="margin-top: 8px; background-color: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                        Bloquear para Pruebas
                    </button>
                </div>
            `;

        } else {
            // Caso 3: Error desconocido (500, 400, etc.)
            statusContainer.innerHTML = `<div style="color: red; padding: 5px;">Error ${response.status} desconocido.</div>`;
        }

    } catch (e) {
        alert("Error de comunicación con el Service Worker (POST).");
    }
}

// Realiza el DELETE para liberar el cliente
async function deleteBlocking(clientId, userName) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (statusContainer) statusContainer.innerHTML = `<div style="color:gray;">Liberando cliente...</div>`;

    try {
        // Llama al Service Worker para hacer el DELETE
        const response = await chrome.runtime.sendMessage({
            action: "API_FETCH",
            method: 'DELETE',
            url: clientId, // DELETE /api/v1/bloqueos/{ID}
        });

        if (response && (response.status === 200 || response.status === 404)) {
            checkBlockingStatus(clientId, userName); // Refresca el estado (debería aparecer Libre)
        } else {
            statusContainer.innerHTML = `<div style="color:red;">Error ${response ? response.status : 'N/A'} al liberar cliente.</div>`;
        }

    } catch (e) {
        alert("Error de comunicación con el Service Worker (DELETE).");
    }
}


// Chequea el estado actual del cliente (GET)
async function checkBlockingStatus(clientId, userName) {
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

        if (response.status === 200) {
            // Caso 1: CLIENTE BLOQUEADO (Éxito)
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
                    <button onclick="liberarCliente('${clientId}', '${bloqueo.usuario_nombre}', '${userName}')" 
                        style="margin-top: 8px; background-color: #cc0000; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                        Liberar (Soy ${bloqueo.usuario_nombre})
                    </button>
                </div>
            `;

        } else if (response.status === 404) {
            // Caso 2: CLIENTE LIBRE (Éxito, no encontrado en BD)
            statusContainer.style.backgroundColor = '#e6ffe6'; 
            statusContainer.style.borderLeft = '4px solid #4CAF50';
            
            statusContainer.innerHTML = `
                <div style="color: #38761d; padding: 5px;">
                    ✅ **Cliente Libre.**
                    <button onclick="pedirBloqueo('${clientId}', '${userName}')" 
                        style="margin-top: 8px; background-color: #4CAF50; color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">
                        Bloquear para Pruebas
                    </button>
                </div>
            `;

        } else {
            // Caso 3: Error Real (500, 400, etc.)
            statusContainer.innerHTML = `<div style="color: red; padding: 5px;">Error ${response.status} desconocido. Revise la API.</div>`;
        }

    } catch (error) {
        console.error("Fallo la comunicación con el Service Worker:", error);
        statusContainer.innerHTML = `<div style="color: orange; padding: 5px;">⚠️ Error de comunicación de extensión.</div>`;
    }
}


// =============================================================
// INICIO DE LA EXTENSIÓN (MODIFICACIÓN DE INYECCIÓN V3)
// =============================================================

function initializeExtension() {
    const clientId = getClientIdFromUrl();
    const userName = getUserNameFromSession();
    
    if (clientId) {
        
        let target = document.querySelector('.slds-page-header__actions'); // 1. Primer intento (Acciones)
        
        if (!target) {
             target = document.querySelector('.oneContent'); // 2. Segundo intento (Contenido general)
        }
        
        if (!target) {
            // 3. TERCER INTENTO (CRÍTICO): Buscar el título del registro o el header
            target = document.querySelector('.slds-page-header'); 
        }
        
        if (!target) {
            // 4. ÚLTIMO RECURSO: Buscar el contenedor del detalle del cliente
             target = document.querySelector('.runtime_appointmentBooker, .runtime_service_page'); 
        }
        
        
        if (target) {
            // Inyectamos el contenedor y procedemos con la verificación
            const container = injectStatusContainer(target);
            checkBlockingStatus(clientId, userName);
        } else {
            console.error("Extensión TMO: Falla al encontrar un punto de inyección estable. Intentando el body...");
            // Si todo falla, inyectar en el body o en un punto fijo.
            if (document.body) {
                // Si inyectas en el body, debes usar CSS para que sea visible
                const container = injectStatusContainer(document.body);
                container.style.position = 'fixed';
                container.style.top = '70px'; // Ajustar para que no cubra el menú
                container.style.right = '20px';
                container.style.zIndex = '9999';
                container.style.width = '350px';
                checkBlockingStatus(clientId, userName);
            }
        }
    }
}

// Inicializar cuando el DOM esté completamente cargado
window.addEventListener('load', initializeExtension);

// También escuchar cambios de navegación en Lightning (Single Page Application)
document.addEventListener('popstate', initializeExtension);