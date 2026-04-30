const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

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

// --- 2. Middlewares ---

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'PUT'] }));
app.use(express.json());

// =============================================================
// ENDPOINTS DE BLOQUEOS (/api/v1/bloqueos)
// =============================================================

/**
 * [GET] /api/v1/bloqueos/:clienteId
 * Verifica el estado del bloqueo y aplica la lógica de expiración.
 */
app.get('/api/v1/bloqueos/:clienteId', async (req, res) => {
    const clienteId = req.params.clienteId;

    try {
        const snapshot = await db.ref('bloqueos').child(clienteId).once('value');
        const bloqueo = snapshot.val();

        if (bloqueo) {
            if (bloqueo.tiempo_expiracion > Date.now()) {
                return res.status(200).json(bloqueo);
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
app.get('/api/v1/bloqueo_clientes/:clienteId', async (req, res, next) => {
    req.url = `/api/v1/bloqueos/${req.params.clienteId}`;
    app.handle(req, res, next);
});


/**
 * [POST] /api/v1/bloqueos
 * Crea un nuevo registro de bloqueo.
 */
app.post('/api/v1/bloqueos', async (req, res) => {
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

    if (!cliente_id || !usuario_nombre || !equipo) {
        return res.status(400).json({ message: "Faltan campos obligatorios: cliente_id, usuario_nombre, equipo." });
    }

    const timestamp_bloqueo = req_timestamp || Date.now();
    const tiempo_expiracion = req_expiracion || (timestamp_bloqueo + (duracion_minutos * 60 * 1000));

    const nuevoBloqueo = {
        cliente_id,
        usuario_nombre,
        equipo,
        usuario_correo: usuario_correo || "",
        pin: pin || "",
        timestamp_bloqueo,
        tiempo_expiracion,
    };

    try {
        await db.ref('bloqueos').child(cliente_id).set(nuevoBloqueo);
        return res.status(201).json({ message: "Bloqueo creado exitosamente", bloqueo: nuevoBloqueo });
    } catch (error) {
        console.error("Error al crear bloqueo:", error);
        return res.status(500).json({ message: "Error interno al guardar" });
    }
});

// Alias para el POST
app.post('/api/v1/bloqueo_clientes', async (req, res, next) => {
    req.url = '/api/v1/bloqueos';
    app.handle(req, res, next);
});


/**
 * [DELETE] /api/v1/bloqueos/:clienteId
 * Elimina el bloqueo (liberación manual).
 * Requiere el PIN del usuario en el body: { usuario: "...", pin: "..." }
 */
app.delete('/api/v1/bloqueos/:clienteId', async (req, res) => {
    const clienteId = req.params.clienteId;
    const { usuario, pin } = req.body || {};

    // Si se envía usuario y PIN, validamos antes de liberar
    if (usuario && pin) {
        try {
            const userSnap = await db.ref('usuarios').child(usuario).once('value');
            const userData = userSnap.val();

            if (!userData) {
                return res.status(404).json({ message: "Usuario no encontrado." });
            }

            if (String(userData.pin) !== String(pin)) {
                return res.status(401).json({ message: "PIN incorrecto. No se puede liberar la cuenta." });
            }

            // PIN correcto → liberar
            await db.ref('bloqueos').child(clienteId).remove();
            console.log(`Bloqueo liberado por ${usuario} para cliente ${clienteId}`);
            return res.status(204).send();

        } catch (error) {
            console.error("Error al validar PIN:", error);
            return res.status(500).json({ message: "Error interno al validar PIN." });
        }
    }

    // Si no se envía PIN (comportamiento legacy / admin), liberar directamente
    try {
        await db.ref('bloqueos').child(clienteId).remove();
        return res.status(204).send();
    } catch (error) {
        console.error("Error al eliminar bloqueo:", error);
        return res.status(500).json({ message: "Error interno al eliminar" });
    }
});

// Alias para el DELETE
app.delete('/api/v1/bloqueo_clientes/:clienteId', async (req, res, next) => {
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
 */
app.post('/api/v1/usuarios', async (req, res) => {
    const { usuario, correo, password, pin, nombre, area } = req.body;

    // Validación de campos obligatorios
    if (!usuario || !correo || !password || !pin || !nombre || !area) {
        return res.status(400).json({
            message: "Faltan campos obligatorios: usuario, correo, password, pin, nombre, area."
        });
    }

    // Validación de formato de correo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(correo)) {
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
        const existing = await db.ref('usuarios').child(usuario).once('value');
        if (existing.val()) {
            return res.status(409).json({ message: `El usuario "${usuario}" ya existe.` });
        }

        const nuevoUsuario = {
            usuario,
            correo,
            password, // En producción considera usar bcrypt para hashear la contraseña
            pin: String(pin),
            nombre,
            area,
            fecha_creacion: Date.now()
        };

        await db.ref('usuarios').child(usuario).set(nuevoUsuario);
        console.log(`Usuario creado: ${usuario}`);

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
 * Valida credenciales de usuario.
 * Body: { usuario, password }
 */
app.post('/api/v1/usuarios/login', async (req, res) => {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
        return res.status(400).json({ message: "Usuario y contraseña son requeridos." });
    }

    try {
        const snapshot = await db.ref('usuarios').child(usuario).once('value');
        const user = snapshot.val();

        if (!user) {
            return res.status(404).json({ message: "Usuario no encontrado." });
        }

        if (user.password !== password) {
            return res.status(401).json({ message: "Contraseña incorrecta." });
        }

        // Retornar datos del usuario (sin password)
        const { password: _pw, ...userData } = user;
        return res.status(200).json({ message: "Login exitoso", usuario: userData });

    } catch (error) {
        console.error("Error en login:", error);
        return res.status(500).json({ message: "Error interno en el servidor." });
    }
});

/**
 * [GET] /api/v1/usuarios
 * Devuelve la lista de todos los usuarios (sin password ni pin).
 */
app.get('/api/v1/usuarios', async (req, res) => {
    try {
        const snapshot = await db.ref('usuarios').once('value');
        const data = snapshot.val();

        if (!data) {
            return res.status(200).json([]);
        }

        // Convertir objeto de Firebase a array y filtrar solo password
        const usuarios = Object.values(data).map(({ password: _pw, ...user }) => user);

        return res.status(200).json(usuarios);

    } catch (error) {
        console.error("Error al listar usuarios:", error);
        return res.status(500).json({ message: "Error interno al obtener usuarios." });
    }
});

/**
 * [GET] /api/v1/usuarios/:usuario
 * Devuelve un usuario específico (sin password ni pin).
 */
app.get('/api/v1/usuarios/:usuario', async (req, res) => {
    const usuarioId = req.params.usuario;

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
 */
app.delete('/api/v1/usuarios/:usuario', async (req, res) => {
    const usuarioId = req.params.usuario;

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
 * Valida el PIN de un usuario sin necesidad de hacer el DELETE.
 * Body: { pin: "1234" }
 * Útil para pre-validar antes de liberar.
 */
app.post('/api/v1/usuarios/:usuario/validar-pin', async (req, res) => {
    const usuarioId = req.params.usuario;
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

        const isValid = String(data.pin) === String(pin);
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
});