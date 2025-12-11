// =============================================================
// SERVICE_WORKER.JS
// Maneja la lógica en segundo plano (background) y actúa como proxy
// para las llamadas a la API, evitando problemas de CORS en el script de contenido.
// =============================================================

// Define la URL base de la API de bloqueo de clientes
// IMPORTANTE: Se ha añadido el prefijo '/api/v1' por si el backend de Render lo está usando.
// La nueva URL de colección para POST será: https://salesforcetmo.onrender.com/api/v1/bloqueo_clientes
const API_BASE_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueo_clientes";

/**
 * Función genérica para manejar las peticiones a la API.
 * Implementa la lógica de reintentos (Exponential Backoff) y devuelve
 * el cuerpo de la respuesta junto con el estado HTTP.
 * @param {string} url - El segmento de la URL después de la base (e.g., 'base' o un ID de cliente).
 * @param {string} method - El método HTTP (GET, POST, DELETE).
 * @param {object} data - Datos para la petición (solo para POST).
 * @param {number} retries - Contador de reintentos.
 */
async function fetchWithRetry(url, method, data = null, retries = 3) {
    // La URL completa ahora se construye dinámicamente:
    // POST (url === 'base'): https://.../api/v1/bloqueo_clientes (SIN barra final)
    // GET/DELETE (url === 'ID'): https://.../api/v1/bloqueo_clientes/ID (SE AÑADE la barra)
    const fullUrl = url === 'base' ? API_BASE_URL : `${API_BASE_URL}/${url}`;

    // ************************************************
    // DEBUG: Confirmar la URL exacta antes de la llamada
    // ************************************************
    console.log(`Service Worker: Realizando ${method} a la URL: ${fullUrl}`);

    const options = {
        method: method,
        headers: {
            'Content-Type': 'application/json'
        },
    };

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
            
            // Retorna inmediatamente si la llamada fue exitosa o si es un error 404/400/201 (manejo de errores de negocio)
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