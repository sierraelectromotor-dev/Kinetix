# Kinetix Telematics

Este es un proyecto completo de rastreo y telemetría vehicular diseñado para correr en una **VPS** con **Node.js** y **PostgreSQL**, compatible con hardware basado en el chip **ESP32** y módem celular **LilyGo T-Call A7670**.

## Estructura del Proyecto

El proyecto está organizado en las siguientes carpetas:

```
kinetix/
│
├── backend/                  # Servidor de API, sockets TCP y WebSocket
│   ├── public/               # Frontend de la interfaz web
│   │   ├── index.html        # Estructura del Dashboard Premium
│   │   ├── style.css         # Estilos Glassmorphism y temas oscuros
│   │   └── app.js            # Lógica y mapa Leaflet interactivo
│   │
│   ├── src/                  # Código fuente del Backend
│   │   ├── db.js             # Conexión con PostgreSQL
│   │   ├── index.js          # Servidores Express, TCP y WebSockets
│   │   └── schema.sql        # Esquema e índices de la base de datos
│   │
│   └── package.json          # Dependencias y scripts de ejecución
│
├── firmware/                 # Código C++ para microcontrolador
│   ├── config.h              # Configuración de APN móvil, VPS y pines
│   └── tracker_firmware.ino  # Firmware principal con conexión celular y GPS
│
└── README.md                 # Documentación básica
```

---

## Guías de Referencia

Para obtener más información sobre el diseño de hardware, el protocolo o el proceso de despliegue, consulta los siguientes documentos creados en la carpeta de artefactos de tu entorno:

1. **Plan de Diseño e Implementación:** Contiene diagramas de flujo de datos, el protocolo de comandos TCP detallado, el circuito físico del optoacoplador para la ignición automotriz y el diagrama transistorizado de control de relevadores de 12V.
2. **Guía de Despliegue en VPS:** Instrucciones detalladas para instalar PostgreSQL, configurar variables en un archivo `.env`, abrir puertos del firewall de la VPS y usar `pm2` para mantener el servidor activo en segundo plano.

---

## Cómo Ejecutar el Servidor Localmente (Desarrollo)

1. Ingresa a la carpeta del backend:
   ```bash
   cd backend
   ```
2. Instala las dependencias necesarias:
   ```bash
   npm install
   ```
3. Configura las credenciales de tu base de datos local en un archivo `.env` en la raíz de la carpeta `backend` (puedes tomar como base el ejemplo de la guía de despliegue).
4. Ejecuta el servidor en modo desarrollo:
   ```bash
   npm run start
   ```
   * El puerto de la API HTTP y el dashboard web estará en: `http://localhost:8080`
   * El puerto del socket TCP para la conexión de los ESP32 estará en: `http://localhost:5000`
