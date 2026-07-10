// State variables
let devices = [];
let selectedImei = null;
let map = null;
const markers = new Map();
let ws = null;
let lastCommandSent = { 0: null, 1: null }; // Track pending commands per output
let historyFeatureGroup = null; // Leaflet layer group for routes
let historyEvents = []; // Trips and stops parsed from querying range
let activeHistoryEventIndex = null;

// Default Map Center (Bogotá, Colombia - can center anywhere)
const DEFAULT_CENTER = [4.6097, -74.0817];
const DEFAULT_ZOOM = 13;

// Helper to get authorization headers
function getAuthHeaders() {
  const token = sessionStorage.getItem('kinetix_token') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };
}

// Initialize elements on load
document.addEventListener('DOMContentLoaded', () => {
  setupLoginHandler();
});

// --- HANDLE LOGIN OVERLAY ---
function setupLoginHandler() {
  const loginOverlay = document.getElementById('login-overlay');
  const formLogin = document.getElementById('form-login');
  const inputPassword = document.getElementById('login-password');
  const btnTogglePwd = document.getElementById('btn-toggle-pwd');
  const loginErrorMsg = document.getElementById('login-error-msg');

  // Toggle password visibility
  btnTogglePwd.addEventListener('click', () => {
    const isPassword = inputPassword.type === 'password';
    inputPassword.type = isPassword ? 'text' : 'password';
    btnTogglePwd.innerHTML = isPassword ? '<i class="fa-solid fa-eye-slash"></i>' : '<i class="fa-solid fa-eye"></i>';
  });

  // Verify stored auth
  if (sessionStorage.getItem('kinetix_auth') === 'true' && sessionStorage.getItem('kinetix_token')) {
    loginOverlay.classList.add('hidden');
    initApp();
  } else {
    loginOverlay.classList.remove('hidden');
  }

  // Handle submit login
  formLogin.addEventListener('submit', (e) => {
    e.preventDefault();
    const pwd = inputPassword.value;
    
    // Validar contraseña
    if (pwd === 'H36&WE1iv@') {
      sessionStorage.setItem('kinetix_auth', 'true');
      sessionStorage.setItem('kinetix_token', pwd);
      loginOverlay.classList.add('hidden');
      loginErrorMsg.classList.add('hidden');
      initApp();
    } else {
      loginErrorMsg.classList.remove('hidden');
      inputPassword.value = '';
      inputPassword.focus();
    }
  });
}

// --- INITIALIZE APPLICATION MODULES ---
function initApp() {
  initMap();
  loadDevices();
  connectWebSocket();
  setupEventListeners();
}

// --- INITIALIZE MAP ---
function initMap() {
  map = L.map('map', {
    zoomControl: true,
    fadeAnimation: true
  }).setView(DEFAULT_CENTER, 6); // Initial zoom-out to show multiple devices

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  historyFeatureGroup = L.featureGroup().addTo(map);
}

// --- FETCH ALL DEVICES ---
async function loadDevices() {
  try {
    const response = await fetch('/api/devices', {
      headers: getAuthHeaders()
    });
    
    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    devices = await response.json();
    renderDeviceList();
    updateMapMarkers();
    updateOnlineCounter();
  } catch (err) {
    console.error('Error al cargar dispositivos:', err);
    document.getElementById('device-list').innerHTML = `
      <div class="no-selection-msg">
        <i class="fa-solid fa-triangle-exclamation" style="color: var(--accent-red)"></i>
        <p>Error de conexión con el servidor.</p>
      </div>
    `;
  }
}

// --- RENDER SIDEBAR DEVICE LIST ---
function renderDeviceList() {
  const container = document.getElementById('device-list');
  container.innerHTML = '';

  if (devices.length === 0) {
    container.innerHTML = `
      <div class="no-selection-msg">
        <i class="fa-solid fa-car-tunnel"></i>
        <p>No hay dispositivos registrados.</p>
      </div>
    `;
    return;
  }

  const query = document.getElementById('device-search').value.toLowerCase();

  devices.forEach((dev) => {
    // Filtrado de búsqueda
    if (query && 
        !dev.name.toLowerCase().includes(query) && 
        !dev.plate.toLowerCase().includes(query) && 
        !dev.imei.includes(query)) {
      return;
    }

    const item = document.createElement('div');
    item.className = `device-item ${dev.is_online ? 'online' : ''} ${dev.last_ign ? 'ign-on' : ''}`;
    if (dev.imei === selectedImei) item.classList.add('active');
    
    // Icon based on vehicle status
    let iconClass = 'fa-solid fa-car';
    if (dev.description && dev.description.toLowerCase().includes('moto')) {
      iconClass = 'fa-solid fa-motorcycle';
    } else if (dev.description && dev.description.toLowerCase().includes('camion')) {
      iconClass = 'fa-solid fa-truck';
    }

    item.innerHTML = `
      <div class="device-item-icon">
        <i class="${iconClass}"></i>
      </div>
      <div class="device-item-details">
        <span class="device-item-name">${dev.name}</span>
        <span class="device-item-sub">${dev.plate ? dev.plate + ' • ' : ''}IMEI: ${dev.imei}</span>
      </div>
      <div class="device-status-badge">
        <span class="badge ${dev.is_online ? 'online' : 'offline'}">${dev.is_online ? 'Online' : 'Offline'}</span>
        ${dev.last_ign ? '<span class="badge ign">Ignición</span>' : ''}
      </div>
    `;

    item.addEventListener('click', () => selectDevice(dev.imei));
    container.appendChild(item);
  });
}

// --- UPDATE DEVICE COUNT ---
function updateOnlineCounter() {
  const count = devices.filter(d => d.is_online).length;
  document.getElementById('online-count').textContent = count;
}

// --- SELECT DEVICE & FETCH DETAILS ---
async function selectDevice(imei) {
  selectedImei = imei;
  
  // Highlight in sidebar
  document.querySelectorAll('.device-item').forEach(el => el.classList.remove('active'));
  renderDeviceList();

  const dev = devices.find(d => d.imei === imei);
  if (!dev) return;

  // Show panels
  document.getElementById('telemetry-empty-msg').classList.add('hidden');
  document.getElementById('telemetry-content').classList.remove('hidden');
  
  document.getElementById('config-empty-msg').classList.add('hidden');
  document.getElementById('config-content').classList.remove('hidden');

  document.getElementById('history-empty-msg').classList.add('hidden');
  document.getElementById('history-content-div').classList.remove('hidden');

  // Fill config form
  document.getElementById('config-name').value = dev.name;
  document.getElementById('config-plate').value = dev.plate || '';
  document.getElementById('config-interval').value = dev.config?.interval || 30;
  document.getElementById('config-desc').value = dev.description || '';

  // Configurar rango de fechas por defecto (Hoy de 00:00 a la hora actual)
  const today = new Date();
  const formatDateTime = (date) => {
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
  document.getElementById('history-start').value = formatDateTime(startOfDay);
  document.getElementById('history-end').value = formatDateTime(today);

  // Limpiar capas previas del historial en el mapa
  if (historyFeatureGroup) historyFeatureGroup.clearLayers();
  document.getElementById('history-results-summary').classList.add('hidden');
  document.getElementById('history-events-list').innerHTML = '';
  historyEvents = [];
  activeHistoryEventIndex = null;

  // Load telemetry logs and command logs
  loadCommandLogs(imei);
  loadTelemetryHistory(imei);
}

// --- LOAD COMMAND LOGS ---
async function loadCommandLogs(imei) {
  const container = document.getElementById('logs-list');
  try {
    const response = await fetch(`/api/devices/${imei}/commands?limit=15`, {
      headers: getAuthHeaders()
    });
    
    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    const logs = await response.json();
    
    container.innerHTML = '';
    if (logs.length === 0) {
      container.innerHTML = '<div class="log-placeholder">Sin comandos enviados recientemente.</div>';
      return;
    }

    logs.forEach(log => {
      const time = new Date(log.created_at).toLocaleTimeString();
      const div = document.createElement('div');
      div.className = 'log-item';
      
      let cmdName = log.command;
      if (log.command === 'set_output') {
        const outName = log.parameters?.index === 0 ? 'Corte Motor' : 'Auxiliar';
        const outVal = log.parameters?.state ? 'ACTIVAR' : 'DESACTIVAR';
        cmdName = `${outName} -> ${outVal}`;
      } else if (log.command === 'set_config') {
        cmdName = `Actualizar Conf (Reporte: ${log.parameters?.config?.interval}s)`;
      }

      div.innerHTML = `
        <span class="log-time">[${time}]</span>
        <span class="log-msg">${cmdName}</span>
        <span class="log-status ${log.status}">${log.status.toUpperCase()}</span>
      `;
      container.appendChild(div);
    });
  } catch (err) {
    console.error('Error cargando comandos:', err);
    container.innerHTML = '<div class="log-placeholder" style="color: var(--accent-red)">Error de lectura de logs.</div>';
  }
}

// --- LOAD TELEMETRY HISTORIC AND SHOW DETAILS ---
async function loadTelemetryHistory(imei) {
  try {
    const response = await fetch(`/api/devices/${imei}/telemetry?limit=1`, {
      headers: getAuthHeaders()
    });

    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    const history = await response.json();
    const dev = devices.find(d => d.imei === imei);
    
    if (history.length > 0) {
      const tel = history[0];
      updateTelemetryUI(tel, dev.is_online);
      
      // Update marker and center map
      if (tel.latitude && tel.longitude) {
        updateMarkerPosition(imei, tel.latitude, tel.longitude, dev.is_online, tel.ignition, tel.speed);
        map.setView([tel.latitude, tel.longitude], 15);
      }
    } else {
      // Sin registros
      resetTelemetryUI();
      document.getElementById('selected-device-map-info').textContent = `Dispositivo ${dev.name} no ha reportado GPS aún.`;
    }
  } catch (err) {
    console.error('Error cargando telemetría:', err);
  }
}

// --- UPDATE TELEMETRY UI FIELDS ---
function updateTelemetryUI(tel, isOnline) {
  document.getElementById('telemetry-speed').textContent = `${parseFloat(tel.speed).toFixed(1)} km/h`;
  
  const ignText = tel.ignition ? 'ENCENDIDO' : 'APAGADO';
  document.getElementById('telemetry-ignition').textContent = ignText;
  
  const ignBg = document.getElementById('ignition-icon-bg');
  const ignIcon = document.getElementById('ignition-icon');
  
  if (tel.ignition) {
    ignBg.className = 'metric-icon bg-yellow';
    ignIcon.className = 'fa-solid fa-key fa-bounce';
  } else {
    ignBg.className = 'metric-icon bg-blue';
    ignIcon.className = 'fa-solid fa-key';
  }

  document.getElementById('telemetry-battery').textContent = tel.battery ? `${parseFloat(tel.battery).toFixed(2)}V` : 'N/A';
  document.getElementById('telemetry-rssi').textContent = tel.rssi ? `${tel.rssi} dBm` : 'N/A';

  // Map Overlay Info
  document.getElementById('selected-device-map-info').innerHTML = `
    <strong>Lat:</strong> ${tel.latitude.toFixed(6)} | 
    <strong>Lng:</strong> ${tel.longitude.toFixed(6)} | 
    <strong>Último reporte:</strong> ${new Date(tel.timestamp).toLocaleTimeString()}
  `;

  // Commands switches update
  document.getElementById('commands-empty-msg').classList.add('hidden');
  document.getElementById('commands-content').classList.remove('hidden');

  const container = document.getElementById('dynamic-commands-list');
  container.innerHTML = '';

  const outputNames = ['Corte de Motor', 'Alarma / Auxiliar'];
  const outputDescs = [
    'Detiene la marcha o arranque del vehículo de forma remota.',
    'Activa la sirena local, luces o relevador auxiliar del vehículo.'
  ];

  // Default to at least 2 outputs if not provided
  const outputsCount = Math.max(tel.outputs ? tel.outputs.length : 0, 2);
  const outputs = tel.outputs || [];

  for (let i = 0; i < outputsCount; i++) {
    const isChecked = !!outputs[i];
    const isPending = !!lastCommandSent[i];
    const finalChecked = isPending ? lastCommandSent[i].state : isChecked;

    const row = document.createElement('div');
    row.className = 'command-row';
    
    row.innerHTML = `
      <div class="command-info">
        <span class="cmd-title">${outputNames[i] || 'Puerto Auxiliar'} (Salida ${i + 1})</span>
        <span class="cmd-desc">${outputDescs[i] || 'Control remoto configurable.'}</span>
      </div>
      <label class="switch ${isPending ? 'loading' : ''}">
        <input type="checkbox" id="switch-output-${i+1}" ${finalChecked ? 'checked' : ''} ${!isOnline ? 'disabled' : ''}>
        <span class="slider round"></span>
      </label>
    `;
    
    container.appendChild(row);

    // Event listener dinámico
    const checkbox = row.querySelector(`#switch-output-${i+1}`);
    checkbox.addEventListener('change', function() {
      if (!selectedImei) return;
      this.parentElement.classList.add('loading');
      sendCommand(selectedImei, i, this.checked);
    });
  }

  if (!isOnline) {
    document.getElementById('commands-panel').classList.add('offline-panel');
  } else {
    document.getElementById('commands-panel').classList.remove('offline-panel');
  }
}

function resetTelemetryUI() {
  document.getElementById('telemetry-speed').textContent = '0.0 km/h';
  document.getElementById('telemetry-ignition').textContent = 'APAGADO';
  document.getElementById('telemetry-battery').textContent = 'N/A';
  document.getElementById('telemetry-rssi').textContent = 'N/A';
  
  document.getElementById('commands-content').classList.add('hidden');
  document.getElementById('commands-empty-msg').classList.remove('hidden');
}

// --- WEBSOCKET CLIENT CONNECTION ---
function connectWebSocket() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const token = sessionStorage.getItem('kinetix_token') || '';
  const wsUrl = `${wsProtocol}//${window.location.host}/?token=${encodeURIComponent(token)}`;
  
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('[WebSocket] Conectado al servidor');
    const dot = document.getElementById('ws-status-dot');
    dot.className = 'pulse-dot green';
    document.getElementById('ws-status-text').textContent = 'Servidor en Línea';
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleWebSocketMessage(data);
    } catch (err) {
      console.error('[WebSocket] Error parsing WS data:', err);
    }
  };

  ws.onclose = (event) => {
    console.warn('[WebSocket] Conexión cerrada. Código:', event.code);
    const dot = document.getElementById('ws-status-dot');
    dot.className = 'pulse-dot red';
    
    if (event.code === 4001) {
      document.getElementById('ws-status-text').textContent = 'No autorizado';
      handleUnauthorized();
    } else {
      document.getElementById('ws-status-text').textContent = 'Reconectando...';
      setTimeout(connectWebSocket, 3000);
    }
  };
}

// --- HANDLE WEBSOCKET RECEIVED DATA ---
function handleWebSocketMessage(data) {
  const { type, imei, telemetry, command, index, success, message } = data;

  switch (type) {
    case 'device_online':
      updateDeviceStatus(imei, true);
      break;
    case 'device_offline':
      updateDeviceStatus(imei, false);
      break;
    case 'telemetry':
      // Actualizar dispositivo local
      const dev = devices.find(d => d.imei === imei);
      if (dev) {
        dev.last_ign = telemetry.ignition;
        dev.is_online = true; // Si reportó telemetría está activo
      }
      
      // Actualizar mapa y barra lateral
      updateMarkerPosition(imei, telemetry.latitude, telemetry.longitude, true, telemetry.ignition, telemetry.speed);
      renderDeviceList();
      updateOnlineCounter();

      // Si es el seleccionado, actualizar UI
      if (imei === selectedImei) {
        updateTelemetryUI(telemetry, true);
      }
      break;

    case 'command_response':
      if (imei === selectedImei) {
        console.log(`[Command Response] Command ACK: Output ${index} = ${success}`);
        
        // Remove loading state
        const switchId = `switch-output-${index + 1}`;
        const sw = document.getElementById(switchId);
        if (sw) {
          sw.parentElement.classList.remove('loading');
          
          if (!success) {
            // Revert state if failed
            sw.checked = !sw.checked;
            alert(`Fallo en el dispositivo: No se pudo ejecutar el comando de salida ${index + 1}.`);
          }
        }
        
        // Reset pending commands tracking
        lastCommandSent[index] = null;
        loadCommandLogs(imei);
      }
      break;
  }
}

// --- UPDATE DEVICE STATUS ---
function updateDeviceStatus(imei, isOnline) {
  const dev = devices.find(d => d.imei === imei);
  if (dev) {
    dev.is_online = isOnline;
    renderDeviceList();
    updateOnlineCounter();
    
    // Update marker icon color if selected
    if (markers.has(imei)) {
      const marker = markers.get(imei);
      // Fetch current geometry position
      const latlng = marker.getLatLng();
      updateMarkerPosition(imei, latlng.lat, latlng.lng, isOnline, dev.last_ign || false, 0);
    }

    if (imei === selectedImei) {
      selectDevice(imei);
    }
  }
}

// --- UPDATE/CREATE MAP MARKER ---
function updateMarkerPosition(imei, lat, lng, isOnline, ignition, speed) {
  // Custom Icon styling
  let colorClass = 'gray';
  if (isOnline) {
    if (ignition) {
      colorClass = speed > 2.0 ? 'green' : 'yellow'; // Green = moving, Yellow = idle
    } else {
      colorClass = 'red'; // Red = Engine off
    }
  }

  const customIcon = L.divIcon({
    className: 'custom-gps-marker',
    html: `
      <div class="marker-pulse ${colorClass}"></div>
      <div class="marker-core ${colorClass}"><i class="fa-solid fa-car"></i></div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const dev = devices.find(d => d.imei === imei);
  const tooltipContent = `
    <strong>${dev?.name || 'Dispositivo'}</strong><br>
    Placa: ${dev?.plate || 'S/P'}<br>
    Estado: ${isOnline ? 'ONLINE' : 'OFFLINE'}
  `;

  if (markers.has(imei)) {
    const marker = markers.get(imei);
    marker.setLatLng([lat, lng]);
    marker.setIcon(customIcon);
    marker.getTooltip().setContent(tooltipContent);
  } else {
    const marker = L.marker([lat, lng], { icon: customIcon })
      .bindTooltip(tooltipContent, { permanent: false, direction: 'top' })
      .addTo(map);
    
    // Click on marker selects device
    marker.on('click', () => selectDevice(imei));
    markers.set(imei, marker);
  }
}

// --- UPDATE ALL MAP MARKERS ---
async function updateMapMarkers() {
  // Clear old markers
  markers.forEach(marker => map.removeLayer(marker));
  markers.clear();

  for (const dev of devices) {
    try {
      const response = await fetch(`/api/devices/${dev.imei}/telemetry?limit=1`, {
        headers: getAuthHeaders()
      });
      
      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const telArr = await response.json();
      if (telArr.length > 0) {
        const tel = telArr[0];
        dev.last_ign = tel.ignition;
        updateMarkerPosition(dev.imei, tel.latitude, tel.longitude, dev.is_online, tel.ignition, tel.speed);
      }
    } catch (e) {
      console.warn('Telemetry check fail for marker setup:', dev.imei);
    }
  }
  
  // Fit map bounds to show all markers if any exist
  if (markers.size > 0) {
    const group = L.featureGroup(Array.from(markers.values()));
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

// --- COMMAND POST TRIGGERS ---
async function sendCommand(imei, index, state) {
  // Set loading in tracking
  lastCommandSent[index] = { index, state };
  
  try {
    const response = await fetch(`/api/devices/${imei}/commands`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        command: 'set_output',
        parameters: { index, state }
      })
    });

    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || 'Fallo al enviar comando.');
    }
    
    // Update logs
    loadCommandLogs(imei);
  } catch (err) {
    console.error('Command Error:', err);
    alert(err.message);
    // Reset toggle
    const sw = document.getElementById(`switch-output-${index + 1}`);
    if (sw) {
      sw.checked = !state;
      sw.parentElement.classList.remove('loading');
    }
    lastCommandSent[index] = null;
  }
}

// --- HANDLE UNAUTHORIZED REQUESTS ---
function handleUnauthorized() {
  sessionStorage.removeItem('kinetix_auth');
  sessionStorage.removeItem('kinetix_token');
  document.getElementById('login-overlay').classList.remove('hidden');
  if (ws) {
    ws.close();
  }
}

// --- SETUP EVENT LISTENERS ---
function setupEventListeners() {
  // Search bar input
  document.getElementById('device-search').addEventListener('input', renderDeviceList);

  // Add Device Modal
  const modal = document.getElementById('modal-register');
  document.getElementById('btn-add-device').addEventListener('click', () => {
    modal.classList.remove('hidden');
  });

  const closeModal = () => {
    modal.classList.add('hidden');
    document.getElementById('form-register').reset();
  };

  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);

  // Register device form submit
  document.getElementById('form-register').addEventListener('submit', async (e) => {
    e.preventDefault();
    const imei = document.getElementById('reg-imei').value;
    const name = document.getElementById('reg-name').value;
    const plate = document.getElementById('reg-plate').value;
    const interval = parseInt(document.getElementById('reg-interval').value);
    const description = document.getElementById('reg-desc').value;

    try {
      const response = await fetch('/api/devices', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          imei,
          name,
          plate,
          description,
          config: { interval, speed_limit: 100 }
        })
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fallo de registro.');

      closeModal();
      await loadDevices();
      selectDevice(imei);
    } catch (err) {
      alert(err.message);
    }
  });

  // Config form submit
  document.getElementById('config-content').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!selectedImei) return;

    const name = document.getElementById('config-name').value;
    const plate = document.getElementById('config-plate').value;
    const interval = parseInt(document.getElementById('config-interval').value);
    const description = document.getElementById('config-desc').value;

    const btn = document.getElementById('btn-save-config');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
    btn.disabled = true;

    try {
      const response = await fetch(`/api/devices/${selectedImei}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          name,
          plate,
          description,
          config: { interval, speed_limit: 100 }
        })
      });

      if (response.status === 401) {
        handleUnauthorized();
        return;
      }

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Fallo al guardar.');

      // Update local state
      const devIndex = devices.findIndex(d => d.imei === selectedImei);
      if (devIndex !== -1) {
        devices[devIndex] = result;
      }
      
      renderDeviceList();
      alert('Configuración guardada exitosamente y enviada al dispositivo.');
    } catch (err) {
      alert(err.message);
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });

  // Delete Device Button click
  document.getElementById('btn-delete-device').addEventListener('click', async () => {
    if (!selectedImei) return;
    const dev = devices.find(d => d.imei === selectedImei);
    if (!dev) return;
    
    if (confirm(`¿Estás seguro de que deseas eliminar el dispositivo "${dev.name}" (IMEI: ${selectedImei}) de forma permanente?`)) {
      try {
        const response = await fetch(`/api/devices/${selectedImei}`, {
          method: 'DELETE',
          headers: getAuthHeaders()
        });

        if (response.status === 401) {
          handleUnauthorized();
          return;
        }

        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Fallo al eliminar.');

        alert('Dispositivo eliminado exitosamente.');

        // Deseleccionar y limpiar UI
        selectedImei = null;
        if (markers.has(dev.imei)) {
          map.removeLayer(markers.get(dev.imei));
          markers.delete(dev.imei);
        }
        
        resetTelemetryUI();
        document.getElementById('telemetry-empty-msg').classList.remove('hidden');
        document.getElementById('telemetry-content').classList.add('hidden');
        document.getElementById('config-empty-msg').classList.remove('hidden');
        document.getElementById('config-content').classList.add('hidden');
        document.getElementById('selected-device-map-info').textContent = 'Selecciona un vehículo para ver sus coordenadas en tiempo real';
        
        await loadDevices();
      } catch (err) {
        alert(err.message);
      }
    }
  });

  // Eliminados los event listeners estáticos de outputs, ahora se generan dinámicamente en updateTelemetryUI.

  // Consultar Historial de Recorridos
  document.getElementById('form-history-query').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!selectedImei) return;
    const start = document.getElementById('history-start').value;
    const end = document.getElementById('history-end').value;
    queryHistory(selectedImei, start, end);
  });

  // Limpiar Mapa de Recorridos
  document.getElementById('btn-clear-history-map').addEventListener('click', () => {
    if (historyFeatureGroup) historyFeatureGroup.clearLayers();
    document.querySelectorAll('.history-event-item').forEach(el => el.classList.remove('active'));
    activeHistoryEventIndex = null;
  });
}

// --- QUERY HISTORY & RENDER RESULTS ---
async function queryHistory(imei, start, end) {
  const container = document.getElementById('history-events-list');
  const btn = document.getElementById('btn-query-history');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Consultando...';
  btn.disabled = true;
  
  if (historyFeatureGroup) historyFeatureGroup.clearLayers();
  document.getElementById('history-results-summary').classList.add('hidden');
  container.innerHTML = '';
  historyEvents = [];
  activeHistoryEventIndex = null;

  try {
    const url = `/api/devices/${imei}/telemetry?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
    const response = await fetch(url, {
      headers: getAuthHeaders()
    });

    if (response.status === 401) {
      handleUnauthorized();
      return;
    }

    const points = await response.json();
    if (points.length === 0) {
      container.innerHTML = '<div class="log-placeholder">Sin reportes de ubicación en este rango de fechas.</div>';
      return;
    }

    // Procesar puntos en viajes y paradas
    historyEvents = parseHistoryEvents(points);
    
    // Calcular totales
    let totalDist = 0;
    let tripCount = 0;
    historyEvents.forEach(ev => {
      if (ev.type === 'trip') {
        tripCount++;
        totalDist += calculateTripDistance(ev.points);
      }
    });

    // Mostrar resumen
    document.getElementById('history-total-distance').textContent = `${totalDist.toFixed(2)} km`;
    document.getElementById('history-total-trips').textContent = tripCount;
    document.getElementById('history-results-summary').classList.remove('hidden');

    // Renderizar lista de eventos
    if (historyEvents.length === 0) {
      container.innerHTML = '<div class="log-placeholder">El dispositivo estuvo sin reportar en este rango.</div>';
      return;
    }

    historyEvents.forEach((ev, idx) => {
      const startTimeStr = new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const endTimeStr = new Date(ev.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const durationStr = formatDuration(ev.durationMs);

      const item = document.createElement('div');
      item.className = `history-event-item ${ev.type}`;
      item.dataset.index = idx;

      if (ev.type === 'stop') {
        item.innerHTML = `
          <div class="history-event-icon">
            <i class="fa-solid fa-square-parking"></i>
          </div>
          <div class="history-event-details">
            <span class="history-event-title">Vehículo Detenido / Parada</span>
            <span class="history-event-time">${startTimeStr} - ${endTimeStr}</span>
          </div>
          <div class="history-event-meta">
            <span>Parado</span>
            <span class="sub-meta">${durationStr}</span>
          </div>
        `;
      } else {
        const dist = calculateTripDistance(ev.points);
        const avgSpeed = ev.durationMs > 0 ? (dist / (ev.durationMs / 3600000)) : 0;
        item.innerHTML = `
          <div class="history-event-icon">
            <i class="fa-solid fa-route"></i>
          </div>
          <div class="history-event-details">
            <span class="history-event-title">En Movimiento / Viaje</span>
            <span class="history-event-time">${startTimeStr} - ${endTimeStr}</span>
          </div>
          <div class="history-event-meta">
            <span>${dist.toFixed(2)} km</span>
            <span class="sub-meta">${durationStr} • ~${avgSpeed.toFixed(1)} km/h</span>
          </div>
        `;
      }

      item.addEventListener('click', () => selectHistoryEvent(idx));
      container.appendChild(item);
    });

    // Dibujar ruta completa por defecto
    drawFullRoute(points);

  } catch (err) {
    console.error('Error cargando historial:', err);
    container.innerHTML = '<div class="log-placeholder" style="color: var(--accent-red)">Error al consultar historial.</div>';
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

// --- SELECT SPECIFIC STOP OR TRIP EVENT ---
function selectHistoryEvent(index) {
  activeHistoryEventIndex = index;
  document.querySelectorAll('.history-event-item').forEach(el => el.classList.remove('active'));
  const activeEl = document.querySelector(`.history-event-item[data-index="${index}"]`);
  if (activeEl) activeEl.classList.add('active');

  const ev = historyEvents[index];
  if (!ev || !historyFeatureGroup) return;

  // Limpiar mapa antes de dibujar el evento seleccionado
  historyFeatureGroup.clearLayers();

  if (ev.type === 'stop') {
    // Dibujar marcador de parada
    const stopIcon = L.divIcon({
      className: 'custom-gps-marker stop-marker',
      html: `
        <div class="marker-pulse red"></div>
        <div class="marker-core red" style="background-color: var(--accent-red) !important;"><i class="fa-solid fa-square-parking" style="color: white; font-size: 8px; display: flex; align-items: center; justify-content: center; height: 100%;"></i></div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([ev.lat, ev.lng], { icon: stopIcon })
      .bindPopup(`
        <strong>Vehículo Detenido / Parada</strong><br>
        <strong>Inicio:</strong> ${ev.start.toLocaleTimeString()}<br>
        <strong>Fin:</strong> ${ev.end.toLocaleTimeString()}<br>
        <strong>Duración:</strong> ${formatDuration(ev.durationMs)}
      `)
      .addTo(historyFeatureGroup);

    map.setView([ev.lat, ev.lng], 16);
    marker.openPopup();
  } else {
    // Dibujar polilínea del viaje
    const latlngs = ev.points.map(p => [p.latitude, p.longitude]);
    
    const polyline = L.polyline(latlngs, {
      color: '#10b981', // Verde esmeralda para viajes
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(historyFeatureGroup);

    map.fitBounds(polyline.getBounds().pad(0.1));

    // Agregar marcadores de inicio y fin del viaje
    const startPoint = ev.points[0];
    const endPoint = ev.points[ev.points.length - 1];

    L.circleMarker([startPoint.latitude, startPoint.longitude], {
      radius: 6,
      color: '#ffffff',
      fillColor: '#3b82f6',
      fillOpacity: 1,
      weight: 2
    }).bindPopup(`<strong>Inicio de Viaje</strong><br>${ev.start.toLocaleTimeString()}`).addTo(historyFeatureGroup);

    L.circleMarker([endPoint.latitude, endPoint.longitude], {
      radius: 6,
      color: '#ffffff',
      fillColor: '#ef4444',
      fillOpacity: 1,
      weight: 2
    }).bindPopup(`<strong>Fin de Viaje</strong><br>${ev.end.toLocaleTimeString()}`).addTo(historyFeatureGroup);
  }
}

// --- DRAW FULL ROUTE ON SEARCH ---
function drawFullRoute(points) {
  if (!historyFeatureGroup || points.length === 0) return;
  historyFeatureGroup.clearLayers();

  const latlngs = points.map(p => [p.latitude, p.longitude]);
  const polyline = L.polyline(latlngs, {
    color: '#06b6d4', // Cyan para ruta completa
    weight: 5,
    opacity: 0.7,
    dashArray: '5, 8', // Línea punteada elegante
    lineCap: 'round',
    lineJoin: 'round'
  }).addTo(historyFeatureGroup);

  // Agregar marcadores de paradas detectadas en el mapa
  historyEvents.forEach(ev => {
    if (ev.type === 'stop') {
      const stopIcon = L.divIcon({
        className: 'custom-gps-marker stop-marker-small',
        html: `<div class="marker-core red" style="background-color: var(--accent-red) !important; width: 10px; height: 10px; border-radius: 50%;"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5]
      });

      L.marker([ev.lat, ev.lng], { icon: stopIcon })
        .bindPopup(`<strong>Parada:</strong> ${formatDuration(ev.durationMs)}<br>De ${ev.start.toLocaleTimeString()} a ${ev.end.toLocaleTimeString()}`)
        .addTo(historyFeatureGroup);
    }
  });

  map.fitBounds(polyline.getBounds().pad(0.1));
}

// --- PARSE POINTS INTO TRIPS & STOPS ---
function parseHistoryEvents(points) {
  if (points.length === 0) return [];
  
  const events = [];
  let currentGroup = [];
  let isMoving = parseFloat(points[0].speed) > 2.0 && points[0].ignition;
  
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const pMoving = parseFloat(p.speed) > 2.0 && p.ignition;
    
    if (pMoving === isMoving) {
      currentGroup.push(p);
    } else {
      processGroup(currentGroup, isMoving, events);
      currentGroup = [p];
      isMoving = pMoving;
    }
  }
  
  if (currentGroup.length > 0) {
    processGroup(currentGroup, isMoving, events);
  }
  
  // Filtrar y combinar paradas muy cortas (menores a 3 minutos) como viajes
  return filterAndCombineEvents(events);
}

function processGroup(group, isMoving, events) {
  const start = new Date(group[0].timestamp);
  const end = new Date(group[group.length - 1].timestamp);
  const durationMs = end - start;
  
  if (isMoving) {
    events.push({
      type: 'trip',
      points: group,
      start,
      end,
      durationMs
    });
  } else {
    events.push({
      type: 'stop',
      lat: group[0].latitude,
      lng: group[0].longitude,
      start,
      end,
      durationMs
    });
  }
}

function filterAndCombineEvents(events) {
  const cleanEvents = [];
  
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    
    // Si la parada dura menos de 3 minutos, la consideramos parte del viaje (espera de tráfico, semáforo)
    if (ev.type === 'stop' && ev.durationMs < 180000) {
      ev.type = 'trip';
      ev.points = [{ latitude: ev.lat, longitude: ev.lng, speed: 0, timestamp: ev.start.toISOString() }];
    }
    
    if (cleanEvents.length === 0) {
      cleanEvents.push(ev);
    } else {
      const last = cleanEvents[cleanEvents.length - 1];
      if (last.type === 'trip' && ev.type === 'trip') {
        last.points = last.points.concat(ev.points || []);
        last.end = ev.end;
        last.durationMs = last.end - last.start;
      } else {
        cleanEvents.push(ev);
      }
    }
  }
  
  return cleanEvents;
}

// --- HELPER METRIC FUNCTIONS ---
function calculateTripDistance(points) {
  let dist = 0;
  for (let i = 0; i < points.length - 1; i++) {
    dist += getHaversineDistance(points[i], points[i+1]);
  }
  return dist;
}

function getHaversineDistance(p1, p2) {
  const R = 6371; // radio terrestre en km
  const dLat = (p2.latitude - p1.latitude) * Math.PI / 180;
  const dLon = (p2.longitude - p1.longitude) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(p1.latitude * Math.PI / 180) * Math.cos(p2.latitude * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function formatDuration(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}
