// =============================================================
// POPUP.JS - CONTROL DE ACCESO SIMPLIFICADO (SEGURO)
// =============================================================

const API_BASE = "https://salesforcetmo.onrender.com/api/v1";
const USUARIOS_URL = `${API_BASE}/usuarios`;

// API Key para autenticación con el servidor
const API_KEY = "sfTMO-ext-2026-secure-key";

// ── UTILIDADES ──────────────────────────────────────────────

function showAlert(containerId, message, type = 'error') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.className = `alert alert-${type} show`;
    el.textContent = message;
    if (type === 'success') {
        setTimeout(() => { el.className = 'alert'; el.textContent = ''; }, 4000);
    }
}

function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    if (el) { el.className = 'alert'; el.textContent = ''; }
}

function switchView(view) {
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    document.getElementById(`view-${view}`).classList.add('active');
}

// ── VALIDACIONES ────────────────────────────────────────────

function validatePin(pin) { return /^\d{4,6}$/.test(pin); }
function validateEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

function updateStrengthBar(password) {
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    if (!password) { fill.style.width = '0%'; text.textContent = ''; return; }

    let score = 0;
    if (password.length >= 6) score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;

    const levels = [
        { label: 'Muy débil', color: '#BA0517', pct: '15%' },
        { label: 'Débil',     color: '#FF6B35', pct: '30%' },
        { label: 'Regular',   color: '#FFB75D', pct: '55%' },
        { label: 'Buena',     color: '#2E844A', pct: '75%' },
        { label: 'Fuerte',    color: '#06A59A', pct: '100%' },
    ];
    const level = levels[Math.min(score - 1, 4)] || levels[0];
    fill.style.width = level.pct;
    fill.style.background = level.color;
    text.textContent = level.label;
    text.style.color = level.color;
}

// ── API ─────────────────────────────────────────────────────

/**
 * Realiza peticiones a la API con API Key y JWT incluidos automáticamente.
 */
async function apiRequest(url, method = 'GET', body = null) {
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
        }
    };

    // Añadir JWT si hay sesión activa
    try {
        const session = await chrome.storage.session.get('authToken');
        if (session.authToken) {
            opts.headers['Authorization'] = `Bearer ${session.authToken}`;
        }
    } catch (e) { /* Sin token disponible */ }

    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ message: res.statusText }));

    // Si el token expiró, limpiar sesión y forzar re-login
    if (res.status === 403 && data?.message?.includes('Token')) {
        chrome.storage.session.remove('authToken');
        chrome.storage.session.remove('activeUser');
        updateLoginView(null);
        showAlert('alert-login', '⚠ Tu sesión expiró. Inicia sesión nuevamente.', 'error');
    }

    return { status: res.status, ok: res.ok, data };
}

// ── HANDLERS ─────────────────────────────────────────────────

async function handleCreateUser() {
    hideAlert('alert-create');
    const fields = {
        usuario: document.getElementById('input-username').value.trim(),
        correo: document.getElementById('input-email').value.trim(),
        password: document.getElementById('input-password').value,
        pin: document.getElementById('input-pin').value.trim(),
        nombre: document.getElementById('input-nombre').value.trim(),
        area: document.getElementById('input-area').value.trim()
    };

    if (Object.values(fields).some(v => !v)) return showAlert('alert-create', '⚠ Todos los campos son obligatorios.');
    if (!validateEmail(fields.correo)) return showAlert('alert-create', '⚠ Formato de correo inválido.');
    if (fields.password.length < 6) return showAlert('alert-create', '⚠ Contraseña muy corta.');
    if (!validatePin(fields.pin)) return showAlert('alert-create', '⚠ PIN debe ser numérico (4-6 dígitos).');

    const btn = document.getElementById('btn-create-user');
    const txt = document.getElementById('btn-create-text');
    btn.disabled = true; txt.textContent = '⚙ Creando...';

    try {
        const res = await apiRequest(USUARIOS_URL, 'POST', { ...fields, fecha_creacion: Date.now() });
        if (res.status === 201) {
            showAlert('alert-create', '✅ Usuario creado exitosamente.', 'success');
            setTimeout(() => switchView('login'), 2000);
        } else {
            showAlert('alert-create', `⚠ ${res.data.message || 'Error al crear usuario'}`);
        }
    } catch (e) { showAlert('alert-create', '🚨 Error de conexión.'); }
    finally { btn.disabled = false; txt.textContent = '✓ Crear usuario'; }
}

async function handleLogin() {
    hideAlert('alert-login');
    const usuario = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!usuario || !password) return showAlert('alert-login', '⚠ Campos obligatorios.');

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    document.getElementById('btn-login-text').textContent = '⌛ Verificando...';

    try {
        const res = await apiRequest(`${API_BASE}/usuarios/login`, 'POST', { usuario, password });
        if (res.status === 200) {
            const userData = res.data.usuario;
            const token = res.data.token;

            // Almacenar usuario activo + JWT en sesión (no persiste al cerrar navegador)
            chrome.storage.session.set({
                'activeUser': userData,
                'authToken': token
            }, () => {
                // Datos mínimos para el content_script (sin PIN ni datos sensibles)
                const lastBlockUpdate = {
                    usuario_nombre: userData.nombre,
                    equipo: userData.area,
                    usuario_correo: userData.correo
                };
                chrome.storage.local.set({ 'lastBlockData': lastBlockUpdate }, () => {
                    updateLoginView(userData);
                });
            });
        } else {
            showAlert('alert-login', `❌ ${res.data.message || 'Error de login'}`);
        }
    } catch (e) { showAlert('alert-login', '🚨 Error de conexión.'); }
    finally {
        btn.disabled = false;
        document.getElementById('btn-login-text').textContent = 'Entrar';
    }
}

function handleLogout() {
    // Limpiar toda la data de sesión y local
    chrome.storage.session.remove(['activeUser', 'authToken'], () => {
        chrome.storage.local.remove('lastBlockData', () => {
            updateLoginView(null);
            document.getElementById('login-username').value = '';
            document.getElementById('login-password').value = '';
        });
    });
}

function updateLoginView(user) {
    const infoDiv = document.getElementById('logged-user-info');
    const loginFields = document.querySelector('.form-grid.single');
    const loginBtn = document.getElementById('btn-login');
    const registerLink = document.querySelector('#view-login div:last-child');

    if (user) {
        infoDiv.style.display = 'block';
        loginFields.style.display = 'none';
        loginBtn.style.display = 'none';
        if (registerLink) registerLink.style.display = 'none';
        
        document.getElementById('active-user-name').textContent = user.nombre;
        document.getElementById('active-user-area').textContent = user.area;
    } else {
        infoDiv.style.display = 'none';
        loginFields.style.display = 'grid';
        loginBtn.style.display = 'inline-flex';
        if (registerLink) registerLink.style.display = 'block';
    }
}

function checkSession() {
    chrome.storage.session.get(['activeUser', 'authToken'], (res) => {
        if (res.activeUser && res.authToken) {
            updateLoginView(res.activeUser);
        } else {
            // Si hay usuario pero no token, limpiar sesión inconsistente
            if (res.activeUser && !res.authToken) {
                chrome.storage.session.remove('activeUser');
            }
            updateLoginView(null);
        }
    });
}

// ── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    checkSession();

    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('btn-create-user').addEventListener('click', handleCreateUser);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    document.getElementById('link-to-register').addEventListener('click', (e) => {
        e.preventDefault(); switchView('register');
    });
    document.getElementById('link-to-login').addEventListener('click', (e) => {
        e.preventDefault(); switchView('login');
    });

    document.getElementById('input-password').addEventListener('input', (e) => updateStrengthBar(e.target.value));
    document.getElementById('input-pin').addEventListener('input', (e) => e.target.value = e.target.value.replace(/\D/g, ''));

    // Footer Status check (incluye API Key)
    apiRequest(`${API_BASE}/ping`).then(res => {
        const el = document.getElementById('footer-status');
        el.textContent = res.ok ? 'Conectado' : 'Servidor Inactivo';
        el.style.color = res.ok ? 'var(--sf-green)' : 'var(--sf-red)';
    }).catch(() => {
        const el = document.getElementById('footer-status');
        el.textContent = 'Sin conexión';
        el.style.color = 'var(--sf-red)';
    });
});