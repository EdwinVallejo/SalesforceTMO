// background.js

// URL de tu API
const BLOCKING_API_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueos";

// Este escucha los mensajes enviados desde content_script.js
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    // Si el mensaje es para la API, lo procesamos
    if (request.action === "API_FETCH") {
        
        // Define la URL completa: base o con ID
        const fullUrl = request.url === "base" ? BLOCKING_API_URL : `${BLOCKING_API_URL}/${request.url}`;
        
        // La función async dentro del listener debe retornar true
        // para indicar que sendResponse será llamado asíncronamente (después del fetch)
        (async () => {
            try {
                const response = await fetch(fullUrl, {
                    method: request.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: request.data ? JSON.stringify(request.data) : null,
                });
    
                // Envía la respuesta completa de vuelta al content script
                const responseData = await response.json().catch(() => ({})); // Maneja respuesta vacía
                sendResponse({
                    status: response.status,
                    data: responseData,
                    ok: response.ok
                });
    
            } catch (error) {
                console.error("Error en Service Worker al contactar API:", error);
                sendResponse({ 
                    status: 500, 
                    data: { message: "Error de conexión del Service Worker" },
                    ok: false
                });
            }
        })();
        
        return true; // Necesario para respuestas asíncronas
    }
});