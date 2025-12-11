// =============================================================
// BACKGROUND.JS (Service Worker)
// =============================================================

const BLOCKING_API_URL = "https://salesforcetmo.onrender.com/api/v1/bloqueos";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    
    if (request.action === "API_FETCH") {
        
        const fullUrl = request.url === "base" ? BLOCKING_API_URL : `${BLOCKING_API_URL}/${request.url}`;
        
        (async () => {
            try {
                const response = await fetch(fullUrl, {
                    method: request.method,
                    headers: { 'Content-Type': 'application/json' },
                    body: request.data ? JSON.stringify(request.data) : null,
                });
    
                const responseData = await response.json().catch(() => ({ message: response.statusText }));
                
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