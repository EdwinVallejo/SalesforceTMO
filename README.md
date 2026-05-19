# Documentación Técnica: Account Blocking To Salesforce (v2.0)

## 1. Visión General y Arquitectura
**Account Blocking To Salesforce** es una extensión de Google Chrome (Manifest V3) diseñada para gestionar la exclusividad temporal de acceso a cuentas ("clientes") dentro de entornos Salesforce. Su objetivo principal es evitar la colisión de trabajo entre agentes mediante un sistema de bloqueo seguro, centralizado y sincronizado en tiempo real.

La arquitectura sigue un modelo **Cliente-Servidor**:
- **Cliente (Extensión Chrome):** Interfaz inyectada en Salesforce (Content Script), panel de control (Popup) y proxy de red en segundo plano (Service Worker).
- **Servidor (Backend Node.js/Express):** API RESTful alojada en Render (`salesforcetmo.onrender.com`), que actúa como fuente de verdad utilizando **Firebase Realtime Database** para el almacenamiento de estado.

---

## 2. Componentes del Sistema

### 2.1 Backend (Servidor)
Ubicado en `server.js`.
- **Tecnologías:** Express.js, Firebase Admin SDK.
- **Responsabilidades:**
  - Gestión integral de usuarios (Registro, Login, Eliminación).
  - Control concurrente de estados de bloqueo y expiración de los mismos.
  - Validación estricta de reglas de negocio (ej. sólo el dueño del bloqueo puede liberarlo).

### 2.2 Frontend (Extensión de Chrome)
- **Manifest (`manifest.json`):** Configurado bajo Manifest V3, solicitando permisos mínimos necesarios (`storage`) y acceso únicamente a dominios autorizados de Salesforce y de la API.
- **Service Worker (`service_worker.js`):** Actúa como proxy seguro de red. Centraliza todas las peticiones a la API para evitar bloqueos por CORS en la página de Salesforce. Implementa inyección de tokens JWT y una estrategia de reintentos por *Exponential Backoff*.
- **Content Script (`content_script.js`):** Inyecta la interfaz de usuario directamente en las páginas de registros de cuentas en Salesforce (`/Account/.../view`). Detecta cambios de URL mediante un `MutationObserver` e interactúa con el usuario a través de Web Components aislados para evitar conflictos de CSS.
- **Popup (`popup.html` / `popup.js`):** Interfaz de gestión de identidad. Permite a los usuarios registrarse, iniciar sesión, visualizar su estado de red y conocer la fortaleza de sus contraseñas.

---

## 3. Arquitectura de Seguridad

La versión 2.0 introduce mejoras de seguridad de grado empresarial. Se aplican los siguientes mecanismos en múltiples capas:

### 3.1 Seguridad en Tránsito y Red
- **API Key Estática (`X-API-Key`):** Todas las solicitudes entre la extensión y el backend requieren un secreto compartido (`sfTMO-ext-2026-secure-key`).
- **Autenticación Basada en Tokens (JWT):** El acceso a endpoints protegidos (crear bloqueo, eliminar bloqueo) requiere un `Bearer Token` firmado digitalmente. Los tokens tienen una expiración configurada (8 horas, equivalente a una jornada laboral estándar).
- **CORS Estricto:** El servidor restringe el origen de las peticiones exclusivamente a extensiones de Chrome (`chrome-extension://*`) y a entornos de desarrollo locales explícitos.
- **Helmet:** Implementación de cabeceras de seguridad HTTP (HSTS, X-Frame-Options, Prevención de Sniffing MIME).

### 3.2 Seguridad de Datos y Almacenamiento
- **Hashing Criptográfico:** Contraseñas de usuario y códigos PIN de liberación son procesados usando `bcrypt` con 10 rondas de salt antes de ser almacenados en Firebase. El servidor **nunca** devuelve hashes en los payloads (Data Sanitization).
- **Almacenamiento Seguro en Cliente:** 
  - La extensión utiliza `chrome.storage.session` para almacenar el token JWT y los datos sensibles de identidad. Esta área en memoria se purga automáticamente al cerrar el navegador.
  - El PIN del usuario **nunca** se almacena, cachead o transmite de forma plana más allá de la validación inicial.

### 3.3 Prevención de Abusos
- **Rate Limiting (Limitación de Tasa):**
  - **Global:** Máximo de 100 peticiones cada 15 minutos por IP para endpoints generales.
  - **Autenticación:** Máximo de 10 intentos cada 15 minutos en los endpoints de inicio de sesión y registro para mitigar ataques de fuerza bruta.
- **Sanitización de Entradas:** Todas las entradas de usuario, incluyendo IDs de Salesforce extraídos de la URL, son sanitizadas eliminando caracteres especiales propensos a inyección de código (XSS o NoSQL injection).

---

## 4. Reglas de Uso y Flujos Operativos

### 4.1 Identidad y Registro
- Es obligatorio registrarse e iniciar sesión a través del Popup de la extensión para interactuar con los bloqueos.
- Las contraseñas deben tener un nivel de seguridad razonable (validado visualmente en el cliente) y el PIN debe constar estrictamente de 4 a 6 dígitos numéricos.

### 4.2 Lógica de Bloqueo
- **Creación:** Un usuario autenticado puede bloquear una cuenta especificando el número de días. La acción queda registrada a nombre de su perfil.
- **Exclusividad:** Mientras un bloqueo esté activo y vigente, la interfaz de Salesforce mostrará un overlay bloqueante para cualquier otro agente, impidiendo la interacción con el registro.
- **Liberación:** Un bloqueo solo puede ser liberado anticipadamente por el **mismo usuario** que lo originó, requiriendo el ingreso de su PIN secreto como verificación de segundo factor.

### 4.3 Acceso Temporal (Emergency Bypass)
- Si una cuenta está bloqueada por otro usuario, se permite un mecanismo de "Acceso Temporal" ingresando el PIN del dueño actual del bloqueo (previa autorización externa).
- Esta acción otorga exactamente **10 segundos** de visibilidad al registro antes de volver a aplicar el overlay bloqueante.

---

## 5. Configuración y Despliegue (DevOps)

### 5.1 Variables de Entorno del Backend
El servidor Node.js debe arrancar con las siguientes variables en su entorno de producción (ej. Render):
- `PORT`: Puerto de escucha (por defecto 3000).
- `JWT_SECRET`: Cadena secreta y compleja para firmar los tokens de sesión.
- `API_KEY`: Clave de acceso de la extensión (`sfTMO-ext-2026-secure-key`).
- `FIREBASE_SERVICE_ACCOUNT`: Objeto JSON (stringificado) con las credenciales de servicio de Google Cloud para el acceso administrativo a la Realtime Database.

### 5.2 Despliegue de la Extensión
1. Instalar dependencias para compilar si existiera algún bundler (actualmente Vanilla JS).
2. Distribuir a través del Chrome Web Store a un grupo privado o cargar en modo desarrollador apuntando a la carpeta raíz del proyecto.
3. Asegurarse de que el servidor Backend reporta un estado 200 en el endpoint `/api/v1/ping` para que la extensión habilite sus funciones de interfaz.
