const express = require('express');
const http = require('http');
const net = require('net');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const db = require('./db');

require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const HTTP_PORT = process.env.PORT || 8080;
const TCP_PORT = process.env.TCP_PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Middleware de Autenticación para la API REST
const AUTH_PASSWORD = 'H36&WE1iv@';

function checkAuth(req, res, next) {
  if (req.path.startsWith('/api')) {
    const authHeader = req.headers['authorization'];
    const queryToken = req.query.token;
    const expectedAuth = `Bearer ${AUTH_PASSWORD}`;
    
    if (authHeader === expectedAuth || queryToken === AUTH_PASSWORD) {
      return next();
    }
    return res.status(401).json({ error: 'No autorizado. Contraseña incorrecta.' });
  }
  next();
}

app.use(checkAuth);

// Registro de Sockets TCP activos (key: imei, value: socket)
const activeSockets = new Map();

// --- INICIALIZACIÓN DE LA BASE DE DATOS ---
async function initDb() {
  try {
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    await db.query(schema);
    console.log('[DB] Esquema y datos iniciales verificados/creados.');
  } catch (err) {
    console.error('[DB] Error cargando el archivo schema.sql:', err.message);
  }
}

// --- WEBSOCKETS (COMUNICACIÓN CON EL DASHBOARD) ---
const wsClients = new Set();

wss.on('connection', (ws, req) => {
  // Proteger conexión WebSocket con token
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    if (token !== AUTH_PASSWORD) {
      console.log('[WebSocket] Conexión rechazada: Token incorrecto. Recibido:', JSON.stringify(token), 'Esperado:', JSON.stringify(AUTH_PASSWORD), 'URL:', req.url);
      ws.close(4001, 'No autorizado');
      return;
    }
  } catch (err) {
    console.error('[WebSocket] Error validando autenticación:', err.message);
    ws.close(4000, 'Error de autenticación');
    return;
  }

  console.log('[WebSocket] Nuevo cliente web conectado');
  wsClients.add(ws);

  // Enviar estado de dispositivos en línea
  ws.send(JSON.stringify({ type: 'welcome', message: 'Conectado al servidor de rastreo' }));

  ws.on('close', () => {
    console.log('[WebSocket] Cliente web desconectado');
    wsClients.delete(ws);
  });
});

function broadcastToWebClients(data) {
  const payload = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// --- SERVIDOR TCP (CONEXIÓN DE DISPOSITIVOS ESP32 + A7670) ---
const tcpServer = net.createServer((socket) => {
  let socketImei = null;
  let buffer = '';

  console.log(`[TCP] Nueva conexión entrante desde ${socket.remoteAddress}:${socket.remotePort}`);

  // Configurar timeouts de inactividad (evita conexiones fantasma en redes celulares)
  socket.setTimeout(120000); // 2 minutos de inactividad

  socket.on('data', async (data) => {
    buffer += data.toString('utf8');
    let newlineIndex = buffer.indexOf('\n');

    while (newlineIndex !== -1) {
      const line = buffer.substring(0, newlineIndex).trim();
      buffer = buffer.substring(newlineIndex + 1);

      if (line) {
        console.log(`[TCP Data] Recibido: ${line}`);
        try {
          const payload = JSON.parse(line);
          await handleDevicePayload(socket, payload);
        } catch (err) {
          console.error('[TCP Error] Falló al parsear JSON del dispositivo:', line, err.message);
          socket.write(JSON.stringify({ error: 'invalid_json' }) + '\n');
        }
      }
      newlineIndex = buffer.indexOf('\n');
    }
  });

  socket.on('timeout', () => {
    console.warn(`[TCP Timeout] Inactividad detectada en ${socket.remoteAddress}. Cerrando socket.`);
    socket.destroy();
  });

  socket.on('error', (err) => {
    console.error(`[TCP Socket Error] Error con dispositivo ${socketImei || 'Desconocido'}:`, err.message);
  });

  socket.on('close', async () => {
    console.log(`[TCP Close] Conexión cerrada con ${socket.remoteAddress}`);
    if (socketImei) {
      activeSockets.delete(socketImei);
      try {
        // Actualizar estado en DB
        await db.query(
          'UPDATE devices SET is_online = false, last_seen = NOW(), updated_at = NOW() WHERE imei = $1',
          [socketImei]
        );
        // Notificar al frontend
        broadcastToWebClients({
          type: 'device_offline',
          imei: socketImei,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error('[TCP/DB Error] Error al desconectar dispositivo:', err.message);
      }
    }
  });

  // Procesador de Mensajes del Dispositivo
  async function handleDevicePayload(currentSocket, payload) {
    const { imei, lat, lng, ign, bat, speed, outs, rssi, cmd_ack, index, success } = payload;

    if (!imei) {
      currentSocket.write(JSON.stringify({ error: 'missing_imei' }) + '\n');
      return;
    }

    // Registrar socket en memoria si es nuevo o cambió
    if (socketImei !== imei) {
      socketImei = imei;
      activeSockets.set(imei, currentSocket);
      console.log(`[TCP Register] Dispositivo registrado: IMEI ${imei}`);

      // Registrar o actualizar dispositivo en base de datos
      await db.query(
        `INSERT INTO devices (imei, name, is_online, last_seen, updated_at)
         VALUES ($1, $2, true, NOW(), NOW())
         ON CONFLICT (imei) DO UPDATE 
         SET is_online = true, last_seen = NOW(), updated_at = NOW()`,
        [imei, `Tracker #${imei.slice(-4)}`]
      );
      
      broadcastToWebClients({ type: 'device_online', imei, timestamp: new Date().toISOString() });
    }

    // Caso A: Reporte de Telemetría Estándar
    if (lat !== undefined && lng !== undefined) {
      console.log(`[Telemetry] Dispositivo ${imei}: Lat=${lat}, Lng=${lng}, Ign=${ign}`);
      
      // Guardar telemetría histórica
      const result = await db.query(
        `INSERT INTO telemetry (imei, latitude, longitude, ignition, battery, speed, outputs, rssi)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, timestamp`,
        [imei, lat, lng, !!ign, bat || null, speed || 0.0, outs || [false, false], rssi || null]
      );
      
      const savedTelemetry = result.rows[0];

      // Broadcast en tiempo real al frontend
      broadcastToWebClients({
        type: 'telemetry',
        imei,
        telemetry: {
          latitude: lat,
          longitude: lng,
          ignition: !!ign,
          battery: bat,
          speed: speed,
          outputs: outs || [false, false],
          rssi: rssi,
          timestamp: savedTelemetry.timestamp
        }
      });

      // Confirmar recepción al dispositivo
      currentSocket.write(JSON.stringify({ status: 'ok' }) + '\n');
    }

    // Caso B: Confirmación de Comando Ejecutado (ACK)
    if (cmd_ack) {
      console.log(`[Command ACK] Dispositivo ${imei} reporta éxito para ${cmd_ack} (Salida ${index}: ${success})`);
      
      // Buscar el comando pendiente más reciente de este tipo
      const cmdResult = await db.query(
        `UPDATE commands 
         SET status = $1, responded_at = NOW() 
         WHERE imei = $2 AND command = $3 AND status = 'sent'
         RETURNING id`,
        [success ? 'acknowledged' : 'failed', imei, cmd_ack]
      );

      // Notificar al Dashboard
      broadcastToWebClients({
        type: 'command_response',
        imei,
        command: cmd_ack,
        index,
        success,
        command_id: cmdResult.rows[0]?.id || null,
        timestamp: new Date().toISOString()
      });
    }
  }
});

// --- HTTP REST API ENDPOINTS ---

// 1. Obtener lista de todos los dispositivos
app.get('/api/devices', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM devices ORDER BY name ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Registrar/Crear un nuevo dispositivo manualmente
app.post('/api/devices', async (req, res) => {
  const { imei, name, plate, description, config } = req.body;
  if (!imei || !name) {
    return res.status(400).json({ error: 'IMEI y Nombre son requeridos.' });
  }
  try {
    const result = await db.query(
      `INSERT INTO devices (imei, name, plate, description, config)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [imei, name, plate || '', description || '', config || '{"interval": 30, "speed_limit": 100}']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') { // Llave duplicada
      return res.status(400).json({ error: 'Un dispositivo con este IMEI ya existe.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 3. Actualizar configuración/detalles de un dispositivo
app.put('/api/devices/:imei', async (req, res) => {
  const { imei } = req.params;
  const { name, plate, description, config } = req.body;
  try {
    // Si el dispositivo está en línea, le enviamos la nueva configuración directamente
    if (config && activeSockets.has(imei)) {
      const socket = activeSockets.get(imei);
      socket.write(JSON.stringify({ cmd: 'set_config', config }) + '\n');
    }

    const result = await db.query(
      `UPDATE devices 
       SET name = COALESCE($1, name),
           plate = COALESCE($2, plate),
           description = COALESCE($3, description),
           config = COALESCE($4, config),
           updated_at = NOW()
       WHERE imei = $5
       RETURNING *`,
      [name, plate, description, config, imei]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Dispositivo no encontrado.' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Eliminar un dispositivo
app.delete('/api/devices/:imei', async (req, res) => {
  const { imei } = req.params;
  try {
    const result = await db.query('DELETE FROM devices WHERE imei = $1 RETURNING *', [imei]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Dispositivo no encontrado.' });
    }
    // Desconectar socket si está activo
    if (activeSockets.has(imei)) {
      activeSockets.get(imei).destroy();
      activeSockets.delete(imei);
    }
    res.json({ message: 'Dispositivo eliminado.', device: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Obtener histórico de telemetría de un dispositivo
app.get('/api/devices/:imei/telemetry', async (req, res) => {
  const { imei } = req.params;
  const limit = req.query.limit || 100;
  try {
    const result = await db.query(
      `SELECT * FROM telemetry 
       WHERE imei = $1 
       ORDER BY timestamp DESC 
       LIMIT $2`,
      [imei, limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Enviar comando (activar/desactivar salidas)
app.post('/api/devices/:imei/commands', async (req, res) => {
  const { imei } = req.params;
  const { command, parameters } = req.body; // command: 'set_output', parameters: { index: 0, state: true }

  if (!command) {
    return res.status(400).json({ error: 'El nombre de comando es requerido.' });
  }

  try {
    // Registrar comando en DB en estado 'pending'
    const cmdResult = await db.query(
      `INSERT INTO commands (imei, command, parameters, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [imei, command, parameters || {}]
    );
    const dbCommand = cmdResult.rows[0];

    // Verificar si el dispositivo está en línea por TCP
    if (!activeSockets.has(imei)) {
      await db.query('UPDATE commands SET status = \'failed\' WHERE id = $1', [dbCommand.id]);
      return res.status(400).json({ error: 'El dispositivo no está en línea.', command: dbCommand });
    }

    const socket = activeSockets.get(imei);

    // Formatear payload del comando TCP
    let tcpPayload = { cmd: command };
    if (command === 'set_output') {
      tcpPayload.index = parameters.index !== undefined ? parameters.index : 0;
      tcpPayload.state = !!parameters.state;
    } else if (command === 'set_config') {
      tcpPayload.config = parameters.config || {};
    }

    // Enviar comando por TCP
    socket.write(JSON.stringify(tcpPayload) + '\n');
    console.log(`[TCP Command Sent] Enviado a ${imei}:`, tcpPayload);

    // Actualizar estado del comando a 'sent'
    const updatedCmdResult = await db.query(
      `UPDATE commands 
       SET status = 'sent', sent_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [dbCommand.id]
    );

    res.json({ message: 'Comando enviado al dispositivo. Esperando respuesta...', command: updatedCmdResult.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Obtener lista de comandos enviados a un dispositivo
app.get('/api/devices/:imei/commands', async (req, res) => {
  const { imei } = req.params;
  const limit = req.query.limit || 20;
  try {
    const result = await db.query(
      `SELECT * FROM commands 
       WHERE imei = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [imei, limit]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INICIO DE SERVIDORES ---
async function start() {
  await initDb();

  // Iniciar servidor HTTP/WebSocket
  server.listen(HTTP_PORT, () => {
    console.log(`[HTTP] API y Dashboard corriendo en http://localhost:${HTTP_PORT}`);
  });

  // Iniciar servidor TCP
  tcpServer.listen(TCP_PORT, () => {
    console.log(`[TCP] Servidor de dispositivos escuchando en el puerto ${TCP_PORT}`);
  });
}

start().catch((err) => {
  console.error('Fallo crítico al iniciar el backend:', err);
});
