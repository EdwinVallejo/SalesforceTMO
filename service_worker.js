// =============================================================
// SERVICE_WORKER.JS
// Maneja la lógica en segundo plano (background) y actúa como proxy
// para las llamadas a la API, evitando problemas de CORS en el script de contenido.
// =============================================================

// Define la URL base de la API de bloqueo de clientes
const API_BASE_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueo_clientes";

// API Key para autenticación de la extensión con el servidor
const API_KEY = "sfTMO-ext-2026-secure-key";

// Configurar acceso a storage.session para scripts de contenido
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

/**
 * Función genérica para manejar las peticiones a la API.
 * Implementa la lógica de reintentos (Exponential Backoff) y devuelve
 * el cuerpo de la respuesta junto con el estado HTTP.
 * Incluye API Key y JWT en todas las peticiones.
 * @param {string} url - El segmento de la URL después de la base (e.g., 'base' o un ID de cliente).
 * @param {string} method - El método HTTP (GET, POST, DELETE).
 * @param {object} data - Datos para la petición (solo para POST).
 * @param {number} retries - Contador de reintentos.
 */
async function fetchWithRetry(url, method, data = null, retries = 3) {
    // La URL completa ahora se construye dinámicamente:
    // POST (url === 'base'): https://.../api/v1/bloqueo_clientes (SIN barra final)
    // GET/DELETE (url === 'ID'): https://.../api/v1/bloqueo_clientes/ID (SE AÑADE la barra)
    // URLs especiales (contienen '/'): se construyen sobre la base de la API
    let fullUrl;
    if (url === 'base') {
        fullUrl = API_BASE_URL;
    } else if (url.includes('/')) {
        // URLs como "usuarios/xxx/validar-pin" — usar base de API
        fullUrl = `https://salesforcetmo.onrender.com/api/v1/${url}`;
    } else {
        fullUrl = `${API_BASE_URL}/${url}`;
    }

    console.log(`Service Worker: Realizando ${method} a la URL: ${fullUrl}`);

    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
        },
    };

    // Obtener JWT de la sesión y añadirlo como Authorization header
    try {
        const session = await chrome.storage.session.get('authToken');
        if (session.authToken) {
            options.headers['Authorization'] = `Bearer ${session.authToken}`;
        }
    } catch (e) {
        console.log("Service Worker: Sin token JWT disponible.");
    }

    if (data && method !== 'GET') {
        options.body = JSON.stringify(data);
    }

    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(fullUrl, options);
            
            let responseData = null;
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                responseData = await response.json();
            } else {
                 responseData = await response.text();
            }

            // Si el token expiró, notificar para forzar re-login
            if (response.status === 403 && responseData?.message?.includes('Token')) {
                chrome.storage.session.remove('authToken');
                chrome.storage.session.remove('activeUser');
                console.log("Service Worker: Token expirado, sesión limpiada.");
            }
            
            // Retorna inmediatamente si la llamada fue exitosa o si es un error de negocio
            return {
                status: response.status,
                data: responseData
            };
        } catch (error) {
            if (i < retries - 1) {
                // Espera exponencial: 1s, 2s, 4s...
                const delay = Math.pow(2, i) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error("Service Worker: Fallo la conexión después de múltiples reintentos.", error);
                throw error; // Lanza el error para que el content script lo maneje
            }
        }
    }
}

// Escucha mensajes del script de contenido
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Verificamos si la acción es una llamada a la API
    if (request.action === "API_FETCH") {
        
        // Llamada asíncrona a la API
        fetchWithRetry(request.url, request.method, request.data)
            .then(response => {
                // Envía la respuesta (status y data) de vuelta al script de contenido
                sendResponse(response);
            })
            .catch(error => {
                // Envía un error genérico o el mensaje de error de red
                sendResponse({
                    status: 500, 
                    data: { message: "Error de red o Service Worker: " + error.message }
                });
            });
            
        // Indica que enviaremos la respuesta de forma asíncrona
        return true; 
    }
});