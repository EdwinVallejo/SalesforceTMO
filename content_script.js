// URL de tu API REST desplegada en Render
const BLOCKING_API_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueos";

// --- Paso 1: Extraer el ID del Cliente del URL ---
function getClientIdFromUrl() {
    // Patrón para capturar el ID de 15 o 18 caracteres de la URL de un registro (Account, Contact, etc.)
    const matches = window.location.pathname.match(/\/lightning\/r\/Account\/([a-zA-Z0-9]{15,18})/);
    return matches ? matches[1] : null;
}

// --- Paso 2: Ejecutar código en el contexto de la página para obtener datos de la sesión ---
// Esto es necesario para evitar las restricciones de seguridad del navegador (sandbox de content_script).
function getSalesforceSessionData() {
    // Código inyectado que se ejecuta en el contexto de la página
    const codeToInject = `
        (function() {
            // Intenta obtener el token del contexto de la sesión de Lightning
            let accessToken = null;
            let instanceUrl = null;
            let currentUserId = null;
            
            // Método común para buscar en la ventana
            if (window.hasOwnProperty('$A')) {
                // $A.clientService.getAccessToken() a veces funciona
                // Pero es más fácil buscar en el contexto de las cookies/variables
            }

            // Una técnica más simple es buscar en el caché de la sesión o usar el dominio.
            instanceUrl = window.location.origin;

            // Para obtener el Access Token, a menudo se usa la cookie "sid" o "sid_l" 
            // y luego se hace una llamada a la API. Como esto es complejo, 
            // nos centraremos en el dominio y usaremos la sesión activa del usuario.

            // Para obtener el nombre del usuario, inyectaremos un elemento oculto.
            // Para simplificar, asumiremos que el nombre del usuario logueado 
            // lo puede obtener el popup o lo pasará el usuario al hacer POST. 
            // POR AHORA, para el GET, solo necesitamos el Client ID.
            
            // Dejamos un marcador para que el content script sepa que el código se ejecutó.
            document.body.setAttribute('data-session-data-ready', 'true');
            
        })();
    `;
    
    const script = document.createElement('script');
    script.textContent = codeToInject;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
}


// --- Paso 3: Consultar el Estado del Bloqueo a la API Externa ---
async function checkBlockingStatus(clientId) {
    if (!clientId) return;

    try {
        const response = await fetch(`${BLOCKING_API_URL}/${clientId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const statusContainer = document.getElementById('blocking-status-container');
        if (!statusContainer) return;

        if (response.status === 200) {
            // Cliente BLOQUEADO
            const bloqueo = await response.json();
            statusContainer.innerHTML = `
                <div style="background-color: #f75d59; color: white; padding: 10px; border-radius: 5px; margin-top: 10px;">
                    🚨 **CLIENTE EN USO POR PRUEBAS**
                    <br>
                    **Encargado:** ${bloqueo.usuario_nombre}
                    <br>
                    **Equipo:** ${bloqueo.equipo}
                    <br>
                    (Libre el ${new Date(bloqueo.tiempo_expiracion).toLocaleTimeString()})
                    <button id="release-button" style="margin-top: 5px;">Liberar (Solo si eres tú)</button>
                </div>
            `;
            // Añadir listener para liberar el bloqueo
            document.getElementById('release-button').addEventListener('click', () => releaseBlocking(clientId));

        } else if (response.status === 404) {
            // Cliente LIBRE
            statusContainer.innerHTML = `
                <div style="background-color: #4CAF50; color: white; padding: 10px; border-radius: 5px; margin-top: 10px;">
                    ✅ **Cliente Libre.**
                    <button id="block-button" style="margin-top: 5px;">Bloquear para Pruebas</button>
                </div>
            `;
            // Añadir listener para bloquear el cliente
            document.getElementById('block-button').addEventListener('click', () => showBlockingForm(clientId));

        } else {
            statusContainer.innerHTML = `<div style="color: red;">Error al consultar la API.</div>`;
        }

    } catch (error) {
        console.error("Fallo la conexión con la API de Bloqueos:", error);
        // Si la instancia gratuita de Render está dormida, puede tardar hasta 50 segundos
        alert("Error de conexión. La API de Bloqueos podría estar inactiva (Render spin down). Intente de nuevo en 30 segundos."); 
    }
}

// --- Lógica de Bloqueo y Liberación (Simplificada para el ejemplo) ---

// Simulación de formulario de bloqueo
function showBlockingForm(clientId) {
    const team = prompt("Cliente libre. Ingresa tu equipo (Ej: QA, UAT):");
    if (team) {
        // En un caso real, obtendrías el nombre del usuario logueado desde la sesión de SF.
        // Por simplicidad, lo pediremos o lo pondremos fijo.
        const userName = prompt("Ingresa tu Nombre Completo (para el bloqueo):"); 
        if (userName) {
            createBlocking(clientId, userName, team);
        }
    }
}

// Función para crear el bloqueo
async function createBlocking(clientId, userName, team) {
    const statusContainer = document.getElementById('blocking-status-container');
    if (statusContainer) statusContainer.innerHTML = "Bloqueando cliente...";

    try {
        await fetch(BLOCKING_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                cliente_id: clientId,
                usuario_nombre: userName,
                equipo: team,
                duracion_minutos: 120 // Bloqueo por 2 horas (lógica definida en server.js)
            })
        });
        // Refresca el estado
        checkBlockingStatus(clientId);
    } catch (e) {
        alert("Error al crear el bloqueo.");
    }
}

// Función para liberar el bloqueo
async function releaseBlocking(clientId) {
     if (confirm("¿Estás seguro de que quieres liberar este cliente?")) {
        try {
            await fetch(`${BLOCKING_API_URL}/${clientId}`, {
                method: 'DELETE'
            });
            // Refresca el estado
            checkBlockingStatus(clientId);
        } catch (e) {
            alert("Error al liberar el cliente.");
        }
    }
}


// --- INICIO DE LA EXTENSIÓN ---

const clientId = getClientIdFromUrl();

if (clientId) {
    // 1. Crear el contenedor donde se mostrará el estado
    const container = document.createElement('div');
    container.id = 'blocking-status-container';
    // Intenta inyectar el contenedor en un lugar visible de la página de Lightning (Ej. cerca del header)
    const header = document.querySelector('.slds-page-header');
    if (header) {
        header.parentNode.insertBefore(container, header.nextSibling);
    }

    // 2. Iniciar el proceso de obtención de datos y chequeo de estado
    getSalesforceSessionData(); // Inyectar código (aunque es simplificado)
    checkBlockingStatus(clientId);
}