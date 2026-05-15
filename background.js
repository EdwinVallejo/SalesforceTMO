// =============================================================
// BACKGROUND.JS (Service Worker)
// Proxy alternativo para llamadas a la API de bloqueos.
// Incluye API Key y JWT en todas las peticiones.
// =============================================================

const BLOCKING_API_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueos";
const API_KEY = "sfTMO-ext-2026-secure-key";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "API_FETCH") {
        
        const fullUrl = request.url === "base" ? BLOCKING_API_URL : `${BLOCKING_API_URL}/${request.url}`;
        
        (async () => {
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'X-API-Key': API_KEY
                };

                // Obtener JWT de la sesión y añadirlo como Authorization header
                try {
                    const session = await chrome.storage.session.get('authToken');
                    if (session.authToken) {
                        headers['Authorization'] = `Bearer ${session.authToken}`;
                    }
                } catch (e) { /* Sin token disponible */ }

                const response = await fetch(fullUrl, {
                    method: request.method,
                    headers: headers,
                    body: request.data ? JSON.stringify(request.data) : null,
                });
    
                const responseData = await response.json().catch(() => ({ message: response.statusText }));

                // Si el token expiró, limpiar sesión
                if (response.status === 403 && responseData?.message?.includes('Token')) {
                    chrome.storage.session.remove('authToken');
                    chrome.storage.session.remove('activeUser');
                }
                
                sendResponse({
                    status: response.status,
                    data: responseData,
                    ok: response.ok
                });
    
            } catch (error) {
                console.error("Error en Service Worker al contactar API:", error);
                sendResponse({ 
                    status: 503, 
                    data: { message: "Error de conexión del Service Worker" },
                    ok: false
                });
            }
        })();
        
        return true; 
    }
});