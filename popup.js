// =============================================================
// POPUP.JS
// Gestión de usuarios desde el popup de la extensión.
// Conecta con el backend en Render para crear y listar usuarios.
// =============================================================

const API_BASE = "https://salesforcetmo.onrender.com/api/v1";
const USUARIOS_URL = `${API_BASE}/usuarios`;

// Paleta de colores para avatares
const AVATAR_COLORS = [
    '#0176D3', '#06A59A', '#2E844A', '#9050E9',
    '#FF8C00', '#D83A00', '#1B5297', '#0B827C'
];

// ── UTILIDADES ──────────────────────────────────────────────

function getAvatarColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(name) {
    return name.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function showAlert(containerId, message, type = 'error') {
    const el = document.getElementById(containerId);
    el.className = `alert alert-${type} show`;
    el.textContent = message;
    if (type === 'success') {
        setTimeout(() => { el.className = 'alert'; el.textContent = ''; }, 4000);
    }
}

function hideAlert(containerId) {
    const el = document.getElementById(containerId);
    el.className = 'alert';
    el.textContent = '';
}

function setButtonLoading(loading) {
    const btn = document.getElementById('btn-create-user');
    const txt = document.getElementById('btn-create-text');
    btn.disabled = loading;
    txt.textContent = loading ? '⚙ Creando usuario...' : '✓ Crear usuario';
}

// ── VALIDACIONES ────────────────────────────────────────────

function validatePin(pin) {
    return /^\d{4,6}$/.test(pin);
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getPasswordStrength(password) {
    let score = 0;
    if (password.length >= 6)  score++;
    if (password.length >= 10) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
}

function updateStrengthBar(password) {
    const fill = document.getElementById('strength-fill');
    const text = document.getElementById('strength-text');
    if (!password) { fill.style.width = '0%'; text.textContent = ''; return; }

    const score = getPasswordStrength(password);
    const levels = [
        { label: 'Muy débil',  color: '#BA0517', pct: '15%' },
        { label: 'Débil',      color: '#FF6B35', pct: '30%' },
        { label: 'Regular',    color: '#FFB75D', pct: '55%' },
        { label: 'Buena',      color: '#2E844A', pct: '75%' },
        { label: 'Fuerte',     color: '#06A59A', pct: '100%' },
    ];
    const level = levels[Math.min(score - 1, 4)] || levels[0];
    fill.style.width = level.pct;
    fill.style.background = level.color;
    text.textContent = level.label;
    text.style.color = level.color;
}

// ── API ─────────────────────────────────────────────────────

async function apiRequest(url, method = 'GET', body = null) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json().catch(() => ({ message: res.statusText }));
    return { status: res.status, ok: res.ok, data };
}

// ── CREAR USUARIO ────────────────────────────────────────────

async function handleCreateUser() {
    hideAlert('alert-create');

    const username  = document.getElementById('input-username').value.trim();
    const email     = document.getElementById('input-email').value.trim();
    const password  = document.getElementById('input-password').value;
    const pin       = document.getElementById('input-pin').value.trim();
    const nombre    = document.getElementById('input-nombre').value.trim();
    const area      = document.getElementById('input-area').value.trim();

    // Validaciones
    if (!username || !email || !password || !pin || !nombre || !area) {
        showAlert('alert-create', '⚠ Todos los campos son obligatorios.', 'error');
        return;
    }
    if (!validateEmail(email)) {
        showAlert('alert-create', '⚠ El correo electrónico no tiene un formato válido.', 'error');
        return;
    }
    if (password.length < 6) {
        showAlert('alert-create', '⚠ La contraseña debe tener al menos 6 caracteres.', 'error');
        return;
    }
    if (!validatePin(pin)) {
        showAlert('alert-create', '⚠ El PIN debe ser numérico y tener entre 4 y 6 dígitos.', 'error');
        return;
    }

    setButtonLoading(true);

    try {
        const payload = {
            usuario: username,
            correo: email,
            password: password,
            pin: pin,
            nombre: nombre,
            area: area,
            fecha_creacion: Date.now()
        };

        const res = await apiRequest(USUARIOS_URL, 'POST', payload);

        if (res.status === 201) {
            showAlert('alert-create', `✅ Usuario "${nombre}" creado exitosamente.`, 'success');
            clearForm();
        } else if (res.status === 409) {
            showAlert('alert-create', `⚠ El usuario "${username}" ya existe. Prueba con otro nombre de usuario.`, 'error');
        } else if (res.status === 400) {
            showAlert('alert-create', `⚠ Error de validación: ${res.data.message}`, 'error');
        } else {
            showAlert('alert-create', '🚨 Error al crear el usuario. Intenta de nuevo.', 'error');
        }
    } catch (err) {
        console.error('Error al crear usuario:', err);
        showAlert('alert-create', '🚨 No se pudo conectar al servidor. Verifica tu conexión.', 'error');
        setFooterStatus(false);
    } finally {
        setButtonLoading(false);
    }
}

// ── LOGIN ────────────────────────────────────────────────────

async function handleLogin() {
    hideAlert('alert-login');
    const usuario = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    if (!usuario || !password) {
        showAlert('alert-login', '⚠ Usuario y contraseña requeridos.', 'error');
        return;
    }

    const btn = document.getElementById('btn-login');
    btn.disabled = true;
    document.getElementById('btn-login-text').textContent = '⌛ Verificando...';

    try {
        const res = await apiRequest(`${API_BASE}/usuarios/login`, 'POST', { usuario, password });
        if (res.status === 200) {
            const userData = res.data.usuario;
            // Guardar en sesión (persiste hasta que se cierre el navegador)
            chrome.storage.session.set({ 'activeUser': userData }, () => {
                // También actualizar lastBlockData para el content script (local para persistencia de campos)
                const lastBlockUpdate = {
                    usuario_nombre: userData.nombre,
                    equipo: userData.area,
                    usuario_correo: userData.correo,
                    pin: userData.pin
                };
                chrome.storage.local.set({ 'lastBlockData': lastBlockUpdate }, () => {
                    showAlert('alert-login', `✅ Bienvenido, ${userData.nombre}`, 'success');
                    updateLoginView(userData);
                });
            });
        } else {
            showAlert('alert-login', `❌ ${res.data.message || 'Error de login'}`, 'error');
        }
    } catch (err) {
        console.error(err);
        showAlert('alert-login', '🚨 Error de conexión.', 'error');
    } finally {
        btn.disabled = false;
        document.getElementById('btn-login-text').textContent = 'Entrar';
    }
}

function updateLoginView(user) {
    const infoDiv = document.getElementById('logged-user-info');
    if (user) {
        infoDiv.style.display = 'block';
        document.getElementById('active-user-name').textContent = user.nombre;
        document.getElementById('active-user-area').textContent = user.area;
    } else {
        infoDiv.style.display = 'none';
    }
}

async function checkSession() {
    chrome.storage.session.get('activeUser', (result) => {
        if (result.activeUser) {
            updateLoginView(result.activeUser);
        }
    });
}

function clearForm() {
    ['input-username','input-email','input-password','input-pin','input-nombre','input-area']
        .forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('strength-fill').style.width = '0%';
    document.getElementById('strength-text').textContent = '';
}

// ── LISTAR USUARIOS ──────────────────────────────────────────

let allUsers = [];

async function loadUsers() {
    const list    = document.getElementById('users-list');
    const loader  = document.getElementById('loading-users');
    const counter = document.getElementById('users-count');

    loader.classList.add('show');
    list.innerHTML = '';
    hideAlert('alert-list');

    try {
        const res = await apiRequest(USUARIOS_URL, 'GET');

        if (res.ok && Array.isArray(res.data)) {
            allUsers = res.data;
            counter.textContent = allUsers.length;
            renderUsers(allUsers);
            setFooterStatus(true);
        } else {
            showAlert('alert-list', '🚨 No se pudo cargar la lista de usuarios.', 'error');
            setFooterStatus(false);
        }
    } catch (err) {
        console.error('Error al cargar usuarios:', err);
        showAlert('alert-list', '🚨 Error de conexión al cargar usuarios.', 'error');
        setFooterStatus(false);
    } finally {
        loader.classList.remove('show');
    }
}

function renderUsers(users) {
    const list = document.getElementById('users-list');
    list.innerHTML = '';

    if (!users || users.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👤</div>
                <p>No se encontraron usuarios.<br>Crea el primero en la pestaña <b>Crear Usuario</b>.</p>
            </div>`;
        return;
    }

    users.forEach(user => {
        const color    = getAvatarColor(user.nombre || user.usuario || 'U');
        const initials = getInitials(user.nombre || user.usuario || 'U');

        const card = document.createElement('div');
        card.className = 'user-card';
        card.innerHTML = `
            <div class="user-avatar" style="background:${color}">${initials}</div>
            <div class="user-info">
                <div class="user-name">${escapeHtml(user.nombre)}</div>
                <div class="user-meta">@${escapeHtml(user.usuario)} · ${escapeHtml(user.correo)}</div>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                <span class="user-area">${escapeHtml(user.area)}</span>
            </div>
        `;
        
        const selectBtn = card.querySelector('.btn-select');
        selectBtn.onclick = (e) => {
            e.preventDefault();
            handleSelectUser(user);
        };
        
        list.appendChild(card);
    });
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

// ── BÚSQUEDA ─────────────────────────────────────────────────

function filterUsers(query) {
    if (!query) { renderUsers(allUsers); return; }
    const q = query.toLowerCase();
    const filtered = allUsers.filter(u =>
        (u.nombre  || '').toLowerCase().includes(q) ||
        (u.usuario || '').toLowerCase().includes(q) ||
        (u.area    || '').toLowerCase().includes(q)
    );
    renderUsers(filtered);
}

// ── FOOTER STATUS ────────────────────────────────────────────

function setFooterStatus(connected) {
    const el = document.getElementById('footer-status');
    el.textContent = connected ? 'Conectado' : 'Sin conexión';
    el.style.color = connected ? 'var(--sf-green)' : 'var(--sf-red)';
}

// ── TABS ─────────────────────────────────────────────────────

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${tabId}`).classList.add('active');

            if (tabId === 'list') loadUsers();
        });
    });
}

// ── INIT ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    checkSession();

    // Botón login
    document.getElementById('btn-login').addEventListener('click', handleLogin);

    // Botón crear usuario
    document.getElementById('btn-create-user').addEventListener('click', handleCreateUser);

    // Barra de fortaleza de contraseña
    document.getElementById('input-password').addEventListener('input', (e) => {
        updateStrengthBar(e.target.value);
    });

    // Solo permitir dígitos en PIN
    document.getElementById('input-pin').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '');
    });

    // Búsqueda en lista
    document.getElementById('search-users').addEventListener('input', (e) => {
        filterUsers(e.target.value.trim());
    });

    // Enter en el formulario
    document.querySelectorAll('#tab-create input').forEach(input => {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleCreateUser();
        });
    });
});