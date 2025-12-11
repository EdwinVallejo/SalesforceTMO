// =============================================================
// BACKGROUND.JS (Service Worker)
// Actúa como proxy para evitar la Content Security Policy (CSP).
// =============================================================

const BLOCKING_API_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueos";

// Escucha los mensajes enviados desde content_script.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Si el mensaje es para la API, lo procesamos
    if (request.action === "API_FETCH") {
        
        // Determina la URL: base o con ID del cliente
        const fullUrl = request.url === "base" ? BLOCKING_API_URL : `${BLOCKING_API_URL}/${request.url}`;
        
        // Se requiere una función asíncrona dentro del listener para usar await
        (async () => {
            try {
                const response = await fetch(fullUrl, {
                    method: request.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: request.data ? JSON.stringify(request.data) : null,
                });
    
                // Intenta parsear JSON, si falla, devuelve un objeto vacío
                const responseData = await response.json().catch(() => ({ message: response.statusText }));
                
                // Envía la respuesta completa (status, data, ok) de vuelta al content script
                sendResponse({
                    status: response.status,
                    data: responseData,
                    ok: response.ok
                });
    
            } catch (error) {
                console.error("Error en Service Worker al contactar API:", error);
                sendResponse({ 
                    status: 503, // Error de servicio no disponible o conexión
                    data: { message: "Error de conexión del Service Worker" },
                    ok: false
                });
            }
        })();
        
        // Retorna true para indicar que sendResponse será llamado asíncronamente
        return true; 
    }
});