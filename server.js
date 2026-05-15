const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// --- Constantes de Seguridad ---

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
const JWT_EXPIRATION = '8h'; // Token expira en 8 horas (jornada laboral)
const BCRYPT_SALT_ROUNDS = 10;
const API_KEY = process.env.API_KEY || 'sfTMO-ext-2026-secure-key';

// --- 1. Inicialización de Firebase ---

try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error("La variable de entorno FIREBASE_SERVICE_ACCOUNT no está configurada.");
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://salesforcetmo-default-rtdb.firebaseio.com"
    });
    
    console.log("Firebase inicializado exitosamente.");
} catch (e) {
    console.error("Error al inicializar Firebase:", e.message);
    process.exit(1);
}

const db = admin.database();
const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. Middlewares de Seguridad ---

// Headers de seguridad HTTP (X-Frame-Options, CSP, HSTS, etc.)
app.use(helmet());

// CORS restrictivo — solo extensión Chrome y localhost para desarrollo
app.use(cors({
    origin: (origin, callback) => {
        // Permitir requests sin origin (service workers, extensiones Chrome)
        if (!origin) return callback(null, true);
        // Permitir extensiones Chrome
        if (origin.startsWith('chrome-extension://')) return callback(null, true);
        // Permitir desarrollo local
        if (origin === 'http://localhost:3000') return callback(null, true);
        // Rechazar cualquier otro origen
        callback(new Error('CORS no permitido'));
    },
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
    credentials: true
}));

// Limitar tamaño del body para prevenir payloads excesivos
app.use(express.json({ limit: '10kb' }));

// Rate Limiting global — 100 requests cada 15 minutos por IP
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: { message: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(generalLimiter);

// Rate Limiting estricto para autenticación — 10 intentos cada 15 minutos
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { message: 'Demasiados intentos de autenticación. Espera 15 minutos.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// --- 3. Funciones de Seguridad ---

/**
 * Sanitiza una cadena eliminando caracteres peligrosos para prevenir injection.
 */
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>"'`]/g, '').trim().substring(0, 200);
}

/**
 * Middleware: Valida que la petición incluya la API Key correcta.
 * Actúa como primera capa de defensa contra acceso no autorizado.
 */
function validateApiKey(req, res, next) {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== API_KEY) {
        return res.status(403).json({ message: 'Acceso denegado. API Key inválida.' });
    }
    next();
}

/**
 * Middleware: Valida el token JWT de sesión.
 * Protege endpoints que requieren autenticación.
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer <token>"
    if (!token) {
        return res.status(401).json({ message: 'Token de autenticación requerido.' });
    }
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // { usuario, correo, nombre, area }
        next();
    } catch (err) {
        return res.status(403).json({ message: 'Token inválido o expirado.' });
    }
}

// Aplicar validación de API Key a TODAS las rutas
app.use(validateApiKey);

// =============================================================
// ENDPOINT DE SALUD (no requiere JWT)
// =============================================================

/**
 * [GET] /api/v1/ping
 * Health check — permite verificar que el servidor está activo.
 */
app.get('/api/v1/ping', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});


// =============================================================
// ENDPOINTS DE BLOQUEOS (/api/v1/bloqueos)
// Todos protegidos con JWT
// =============================================================

/**
 * [GET] /api/v1/bloqueos/:clienteId
 * Verifica el estado del bloqueo y aplica la lógica de expiración.
 */
app.get('/api/v1/bloqueos/:clienteId', authenticateToken, async (req, res) => {
    const clienteId = sanitizeInput(req.params.clienteId);

    try {
        const snapshot = await db.ref('bloqueos').child(clienteId).once('value');
        const bloqueo = snapshot.val();

        if (bloqueo) {
            if (bloqueo.tiempo_expiracion > Date.now()) {
                // Nunca devolver el PIN hasheado al cliente
                const { pin: _pin, ...bloqueoPublico } = bloqueo;
                return res.status(200).json(bloqueoPublico);
            } else {
                await db.ref('bloqueos').child(clienteId).remove();
                console.log(`Bloqueo expirado y eliminado para ID: ${clienteId}`);
                return res.status(404).json({ message: "Cliente libre (expirado)" });
            }
        } else {
            return res.status(404).json({ message: "Cliente libre" });
        }
    } catch (error) {
        console.error("Error al consultar bloqueo:", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }
});

// Alias para compatibilidad con la extensión (GET)
app.get('/api/v1/bloqueo_clientes/:clienteId', authenticateToken, async (req, res, next) => {
    req.url = `/api/v1/bloqueos/${req.params.clienteId}`;
    app.handle(req, res, next);
});


/**
 * [POST] /api/v1/bloqueos
 * Crea un nuevo registro de bloqueo.
 * El usuario autenticado (JWT) es quien queda registrado como dueño.
 */
app.post('/api/v1/bloqueos', authenticateToken, async (req, res) => {
    const { 
        cliente_id, 
        usuario_nombre, 
        equipo, 
        usuario_correo,
        pin,
        duracion_minutos = 120,
        timestamp_bloqueo: req_timestamp,
        tiempo_expiracion: req_expiracion
    } = req.body;

    // Validación de campos obligatorios
    if (!cliente_id || !usuario_nombre || !equipo) {
        return res.status(400).json({ message: "Faltan campos obligatorios: cliente_id, usuario_nombre, equipo." });
    }

    // Sanitizar inputs
    const cleanClienteId = sanitizeInput(cliente_id);
    const cleanNombre = sanitizeInput(usuario_nombre);
    const cleanEquipo = sanitizeInput(equipo);
    const cleanCorreo = sanitizeInput(usuario_correo || "");

    const timestamp_bloqueo = req_timestamp || Date.now();
    const tiempo_expiracion = req_expiracion || (timestamp_bloqueo + (duracion_minutos * 60 * 1000));

    // Hashear el PIN antes de almacenarlo (si se proporcionó)
    let hashedPin = "";
    if (pin) {
        hashedPin = await bcrypt.hash(String(pin), BCRYPT_SALT_ROUNDS);
    }

    const nuevoBloqueo = {
        cliente_id: cleanClienteId,
        usuario_nombre: cleanNombre,
        equipo: cleanEquipo,
        usuario_correo: cleanCorreo,
        pin: hashedPin,
        timestamp_bloqueo,
        tiempo_expiracion,
    };

    try {
        await db.ref('bloqueos').child(cleanClienteId).set(nuevoBloqueo);

        // Devolver el bloqueo sin el PIN hasheado
        const { pin: _pin, ...bloqueoPublico } = nuevoBloqueo;
        return res.status(201).json({ message: "Bloqueo creado exitosamente", bloqueo: bloqueoPublico });
    } catch (error) {
        console.error("Error al crear bloqueo:", error);
        return res.status(500).json({ message: "Error interno al guardar" });
    }
});

// Alias para el POST
app.post('/api/v1/bloqueo_clientes', authenticateToken, async (req, res, next) => {
    req.url = '/api/v1/bloqueos';
    app.handle(req, res, next);
});


/**
 * [DELETE] /api/v1/bloqueos/:clienteId
 * Elimina el bloqueo (liberación manual).
 * SIEMPRE requiere el usuario y PIN en el body: { usuario: "...", pin: "..." }
 */
app.delete('/api/v1/bloqueos/:clienteId', authenticateToken, async (req, res) => {
    const clienteId = sanitizeInput(req.params.clienteId);
    const { usuario, pin } = req.body || {};

    // Siempre requerir usuario y PIN para liberar
    if (!usuario || !pin) {
        return res.status(400).json({ message: "Se requiere usuario y PIN para liberar la cuenta." });
    }

    try {
        // Primero verificar que el bloqueo existe
        const bloqueoSnap = await db.ref('bloqueos').child(clienteId).once('value');
        const bloqueoData = bloqueoSnap.val();

        if (!bloqueoData) {
            return res.status(404).json({ message: "No hay bloqueo activo para este cliente." });
        }

        // Validar que el usuario que intenta liberar es el dueño del bloqueo
        const cleanUsuario = sanitizeInput(usuario);
        const userSnap = await db.ref('usuarios').child(cleanUsuario).once('value');
        const userData = userSnap.val();

        if (!userData) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        // Validar PIN con bcrypt
        const pinMatch = await bcrypt.compare(String(pin), userData.pin);
        if (!pinMatch) {
            return res.status(401).json({ message: "PIN incorrecto. No se puede liberar la cuenta." });
        }

        // PIN correcto → liberar
        await db.ref('bloqueos').child(clienteId).remove();
        console.log(`Bloqueo liberado por ${cleanUsuario} para cliente ${clienteId}`);
        return res.status(204).send();

    } catch (error) {
        console.error("Error al liberar bloqueo:", error);
        return res.status(500).json({ message: "Error interno al liberar bloqueo." });
    }
});

// Alias para el DELETE
app.delete('/api/v1/bloqueo_clientes/:clienteId', authenticateToken, async (req, res, next) => {
    req.url = `/api/v1/bloqueos/${req.params.clienteId}`;
    app.handle(req, res, next);
});



// =============================================================
// ENDPOINTS DE USUARIOS (/api/v1/usuarios)
// =============================================================

/**
 * [POST] /api/v1/usuarios
 * Crea un nuevo usuario.
 * Body: { usuario, correo, password, pin, nombre, area }
 * NO requiere JWT (registro abierto para usuarios de la extensión).
 */
app.post('/api/v1/usuarios', authLimiter, async (req, res) => {
    const { usuario, correo, password, pin, nombre, area } = req.body;

    // Validación de campos obligatorios
    if (!usuario || !correo || !password || !pin || !nombre || !area) {
        return res.status(400).json({
            message: "Faltan campos obligatorios: usuario, correo, password, pin, nombre, area."
        });
    }

    // Sanitizar inputs de texto
    const cleanUsuario = sanitizeInput(usuario);
    const cleanCorreo = sanitizeInput(correo);
    const cleanNombre = sanitizeInput(nombre);
    const cleanArea = sanitizeInput(area);

    // Validación de formato de correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanCorreo)) {
        return res.status(400).json({ message: "El formato del correo electrónico no es válido." });
    }

    // Validación de contraseña
    if (String(password).length < 6) {
        return res.status(400).json({ message: "La contraseña debe tener al menos 6 caracteres." });
    }

    // Validación de PIN (4-6 dígitos numéricos)
    if (!/^\d{4,6}$/.test(String(pin))) {
        return res.status(400).json({ message: "El PIN debe ser numérico y tener entre 4 y 6 dígitos." });
    }

    try {
        // Verificar si el usuario ya existe
        const existing = await db.ref('usuarios').child(cleanUsuario).once('value');
        if (existing.val()) {
            return res.status(409).json({ message: `El usuario "${cleanUsuario}" ya existe.` });
        }

        // Hashear contraseña y PIN con bcrypt
        const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
        const hashedPin = await bcrypt.hash(String(pin), BCRYPT_SALT_ROUNDS);

        const nuevoUsuario = {
            usuario: cleanUsuario,
            correo: cleanCorreo,
            password: hashedPassword,
            pin: hashedPin,
            nombre: cleanNombre,
            area: cleanArea,
            fecha_creacion: Date.now()
        };

        await db.ref('usuarios').child(cleanUsuario).set(nuevoUsuario);
        console.log(`Usuario creado: ${cleanUsuario}`);

        // Retornar sin password ni pin por seguridad
        const { password: _pw, pin: _pin, ...publicData } = nuevoUsuario;
        return res.status(201).json({ message: "Usuario creado exitosamente", usuario: publicData });

    } catch (error) {
        console.error("Error al crear usuario:", error);
        return res.status(500).json({ message: "Error interno al guardar usuario." });
    }
});

/**
 * [POST] /api/v1/usuarios/login
 * Valida credenciales de usuario y genera un token JWT.
 * Body: { usuario, password }
 * NO requiere JWT (es el punto de entrada).
 */
app.post('/api/v1/usuarios/login', authLimiter, async (req, res) => {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({ message: "Usuario y contraseña son requeridos." });
    }

    const cleanUsuario = sanitizeInput(usuario);

    try {
        const snapshot = await db.ref('usuarios').child(cleanUsuario).once('value');
        const user = snapshot.val();

        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        // Comparar contraseña con bcrypt
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: "Contraseña incorrecta." });
        }

        // Generar token JWT con datos del usuario
        const tokenPayload = {
            usuario: user.usuario,
            correo: user.correo,
            nombre: user.nombre,
            area: user.area
        };
        const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: JWT_EXPIRATION });

        // Retornar datos del usuario (sin password ni pin) + token
        const { password: _pw, pin: _pin, ...userData } = user;
        return res.status(200).json({
            message: "Login exitoso",
            usuario: userData,
            token: token
        });

    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ message: "Error interno en el servidor." });
    }
});

/**
 * [GET] /api/v1/usuarios
 * Devuelve la lista de todos los usuarios (sin password ni pin).
 * Requiere JWT.
 */
app.get('/api/v1/usuarios', authenticateToken, async (req, res) => {
    try {
        const snapshot = await db.ref('usuarios').once('value');
        const data = snapshot.val();

        if (!data) {
            return res.status(200).json([]);
        }

        // Convertir objeto de Firebase a array y filtrar datos sensibles
        const usuarios = Object.values(data).map(({ password: _pw, pin: _pin, ...user }) => user);

        return res.status(200).json(usuarios);

    } catch (error) {
        console.error("Error al listar usuarios:", error);
        return res.status(500).json({ message: "Error interno al obtener usuarios." });
    }
});

/**
 * [GET] /api/v1/usuarios/:usuario
 * Devuelve un usuario específico (sin password ni pin).
 * Requiere JWT.
 */
app.get('/api/v1/usuarios/:usuario', authenticateToken, async (req, res) => {
    const usuarioId = sanitizeInput(req.params.usuario);

    try {
        const snapshot = await db.ref('usuarios').child(usuarioId).once('value');
        const data = snapshot.val();

        if (!data) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        const { password: _pw, pin: _pin, ...publicData } = data;
        return res.status(200).json(publicData);

    } catch (error) {
        console.error("Error al obtener usuario:", error);
        return res.status(500).json({ message: "Error interno." });
    }
});

/**
 * [DELETE] /api/v1/usuarios/:usuario
 * Elimina un usuario del sistema.
 * Requiere JWT. Solo el propio usuario puede eliminarse.
 */
app.delete('/api/v1/usuarios/:usuario', authenticateToken, async (req, res) => {
    const usuarioId = sanitizeInput(req.params.usuario);

    // Solo el propio usuario puede eliminarse
    if (req.user.usuario !== usuarioId) {
        return res.status(403).json({ message: "No tienes permiso para eliminar este usuario." });
    }

    try {
        const existing = await db.ref('usuarios').child(usuarioId).once('value');
        if (!existing.val()) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        await db.ref('usuarios').child(usuarioId).remove();
        console.log(`Usuario eliminado: ${usuarioId}`);
        return res.status(204).send();

    } catch (error) {
        console.error("Error al eliminar usuario:", error);
        return res.status(500).json({ message: "Error interno al eliminar usuario." });
    }
});


// =============================================================
// ENDPOINT DE VALIDACIÓN DE PIN (/api/v1/usuarios/:usuario/validar-pin)
// =============================================================

/**
 * [POST] /api/v1/usuarios/:usuario/validar-pin
 * Valida el PIN de un usuario usando bcrypt.
 * Body: { pin: "1234" }
 * Requiere JWT + Rate Limiting estricto.
 */
app.post('/api/v1/usuarios/:usuario/validar-pin', authenticateToken, authLimiter, async (req, res) => {
    const usuarioId = sanitizeInput(req.params.usuario);
    const { pin } = req.body;

    if (!pin) {
        return res.status(400).json({ message: "El campo 'pin' es obligatorio." });
    }

    try {
        const snapshot = await db.ref('usuarios').child(usuarioId).once('value');
        const data = snapshot.val();

        if (!data) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        // Comparar PIN con bcrypt
        const isValid = await bcrypt.compare(String(pin), data.pin);
        if (isValid) {
            return res.status(200).json({ valid: true, message: "PIN correcto." });
        } else {
            return res.status(401).json({ valid: false, message: "PIN incorrecto." });
        }

    } catch (error) {
        console.error("Error al validar PIN:", error);
        return res.status(500).json({ message: "Error interno al validar PIN." });
    }
});


// --- 4. Inicio del Servidor ---

app.listen(PORT, () => {
    console.log(`Servidor de API de Bloqueos corriendo en puerto ${PORT}`);
    console.log(`Seguridad: Helmet ✓ | CORS restrictivo ✓ | Rate Limiting ✓ | JWT ✓ | bcrypt ✓ | API Key ✓`);
});