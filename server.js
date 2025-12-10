const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

// --- 1. Inicialización de Firebase (Usando Variables de Entorno) ---

// CRÍTICO: Lee las credenciales JSON de la variable de entorno.
// Esto es necesario para la seguridad y el despliegue en Render/Heroku.
try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
        throw new Error("La variable de entorno FIREBASE_SERVICE_ACCOUNT no está configurada.");
    }
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    // Inicializa la aplicación Firebase
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        // Reemplaza <TU-ID> con el ID real de tu proyecto Firebase
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com` 
    });
    
    console.log("Firebase inicializado exitosamente.");
} catch (e) {
    console.error("Error al inicializar Firebase:", e.message);
    process.exit(1); // Detiene la aplicación si la inicialización falla
}

const db = admin.database();
const app = express();
const PORT = process.env.PORT || 3000;

// --- 2. Middlewares ---

// Habilita CORS para que la extensión de Chrome pueda llamar a esta API.
// CRÍTICO: Idealmente, solo permitirías el dominio de tu Sandbox de Salesforce.
// Por simplicidad, permitimos todos los orígenes por ahora:
app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'DELETE']
}));

app.use(express.json()); // Permite a la API leer JSON en el cuerpo de las peticiones

// --- 3. Endpoints de la API REST ---

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
            // Lógica de expiración: Si el tiempo actual es mayor al tiempo de expiración
            if (bloqueo.tiempo_expiracion > Date.now()) {
                // El bloqueo es VÁLIDO
                return res.status(200).json(bloqueo);
            } else {
                // Bloqueo EXPIRADO: Lo eliminamos automáticamente
                await db.ref('bloqueos').child(clienteId).remove();
                console.log(`Bloqueo expirado y eliminado para ID: ${clienteId}`);
                // Reportar 404 para indicar que el cliente está libre
                return res.status(404).json({ message: "Cliente libre (expirado)" });
            }
        } else {
            // No se encontró bloqueo
            return res.status(404).json({ message: "Cliente libre" });
        }
    } catch (error) {
        console.error("Error al consultar bloqueo:", error);
        return res.status(500).json({ message: "Error interno del servidor" });
    }
});

/**
 * [POST] /api/v1/bloqueos
 * Crea un nuevo registro de bloqueo.
 */
app.post('/api/v1/bloqueos', async (req, res) => {
    // duracion_minutos por defecto es 120 minutos (2 horas)
    const { cliente_id, usuario_nombre, equipo, duracion_minutos = 120 } = req.body;

    if (!cliente_id || !usuario_nombre || !equipo) {
        return res.status(400).json({ message: "Faltan campos obligatorios: cliente_id, usuario_nombre, equipo." });
    }

    const timestamp_bloqueo = Date.now();
    // Calcula la expiración: tiempo actual + minutos * 60 segundos * 1000 milisegundos
    const tiempo_expiracion = timestamp_bloqueo + (duracion_minutos * 60 * 1000);

    const nuevoBloqueo = {
        cliente_id,
        usuario_nombre,
        equipo,
        timestamp_bloqueo,
        tiempo_expiracion,
    };

    try {
        // Guarda el objeto en la colección 'bloqueos', usando el cliente_id como clave
        await db.ref('bloqueos').child(cliente_id).set(nuevoBloqueo);
        return res.status(201).json({ message: "Bloqueo creado exitosamente", bloqueo: nuevoBloqueo });
    } catch (error) {
        console.error("Error al crear bloqueo:", error);
        return res.status(500).json({ message: "Error interno al guardar" });
    }
});

/**
 * [DELETE] /api/v1/bloqueos/:clienteId
 * Elimina el registro de bloqueo (liberación manual).
 */
app.delete('/api/v1/bloqueos/:clienteId', async (req, res) => {
    const clienteId = req.params.clienteId;

    try {
        await db.ref('bloqueos').child(clienteId).remove();
        // 204 No Content indica éxito sin necesidad de devolver un cuerpo de respuesta
        return res.status(204).send(); 
    } catch (error) {
        console.error("Error al eliminar bloqueo:", error);
        return res.status(500).json({ message: "Error interno al eliminar" });
    }
});


// --- 4. Inicio del Servidor ---

app.listen(PORT, () => {
    console.log(`Servidor de API de Bloqueos corriendo en puerto ${PORT}`);
});
