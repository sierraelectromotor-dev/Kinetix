/**
 * Kinetix Tracker - Firmware ESP32 (Híbrido WiFi + GPS)
 * 
 * Este programa utiliza el Wi-Fi del ESP32 para conectarse al servidor TCP de la VPS,
 * y en paralelo se comunica con el módem A7670 por puerto Serial usando la librería
 * TinyGSM para activar y leer el GPS integrado de forma robusta.
 */

#include <Arduino.h>
#include <WiFi.h>
#include "utilities.h"
#include "config.h"

// Configuración de la librería TinyGSM
#define TINY_GSM_RX_BUFFER 1024
#define SerialMon Serial
#define TINY_GSM_DEBUG SerialMon

#include <TinyGsmClient.h>

#ifdef DUMP_AT_COMMANDS
#include <StreamDebugger.h>
StreamDebugger debugger(SerialAT, SerialMon);
TinyGsm modem(debugger);
#else
TinyGsm modem(SerialAT);
#endif

// Cliente TCP nativo de ESP32 para conexión por Wi-Fi
WiFiClient tcpClient;

// Variables de estado global
String imei = DEVICE_IMEI;
bool isTcpConnected = false;
unsigned long lastReportTime = 0;
int reportInterval = DEFAULT_REPORT_INTERVAL;

// Estado actual de salidas
bool outputStates[2] = {false, false};

// Variables de datos GPS e instrumentación
double latitude = 0.0;
double longitude = 0.0;
float gpsSpeed = 0.0;
int rssi = 99;

// Declaración de funciones
void connectToWiFi();
void powerOnModemGPS();
void readGPS();
void sendTelemetry();
void checkIncomingData();
void handleCommand(const String& jsonCmd);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- RASTREADOR KINETIX (MODO WIFI + GPS TINYGSM) ---");

  // Configurar pines de Entradas/Salidas
  pinMode(PIN_IGNITION, INPUT_PULLUP);
  pinMode(PIN_OUTPUT_1, OUTPUT);
  pinMode(PIN_OUTPUT_2, OUTPUT);
  
  digitalWrite(PIN_OUTPUT_1, LOW);
  digitalWrite(PIN_OUTPUT_2, LOW);

  // Iniciar conexión Wi-Fi
  connectToWiFi();

  // Iniciar comunicación Serial con el A7670 usando pines de utilities.h
  // MODEM_RX_PIN y MODEM_TX_PIN están definidos para el hardware específico
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(500);

  // Encender el módem A7670 y activar antena GPS
  powerOnModemGPS();
}

void loop() {
  // Asegurar conexión Wi-Fi activa
  if (WiFi.status() != WL_CONNECTED) {
    isTcpConnected = false;
    connectToWiFi();
    return;
  }

  // Asegurar conexión TCP activa con la VPS por medio de Wi-Fi
  if (!tcpClient.connected()) {
    isTcpConnected = false;
    Serial.print("[TCP] Conectando a servidor VPS en ");
    Serial.print(SERVER_IP);
    Serial.print(":");
    Serial.println(SERVER_PORT);
    
    if (tcpClient.connect(SERVER_IP, SERVER_PORT)) {
      Serial.println("[TCP] Conectado exitosamente al Backend por Wi-Fi!");
      isTcpConnected = true;
    } else {
      Serial.println("[TCP] Error de conexión al servidor VPS. Reintentando en 3s...");
      delay(3000);
      return;
    }
  }

  // Leer coordenadas de la antena GPS usando TinyGSM
  readGPS();

  // Leer señal de Wi-Fi (como aproximación de RSSI para pruebas)
  rssi = WiFi.RSSI();

  // Escuchar comandos entrantes desde el servidor TCP por Wi-Fi
  checkIncomingData();

  // Enviar telemetría periódica
  unsigned long currentMillis = millis();
  if (currentMillis - lastReportTime >= (reportInterval * 1000UL)) {
    lastReportTime = currentMillis;
    if (isTcpConnected && tcpClient.connected()) {
      sendTelemetry();
    }
  }

  delay(100);
}

// --- CONECTAR A LA RED WI-FI ---
void connectToWiFi() {
  Serial.print("[WIFI] Conectando a SSID: ");
  Serial.println(WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] ¡Conectado con éxito!");
    Serial.print("[WIFI] Dirección IP Local: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WIFI] Error al conectar. Se reintentará en el loop principal.");
  }
}

// --- ENCENDER EL MÓDEM A7670 Y INICIALIZAR GPS ---
void powerOnModemGPS() {
  Serial.println("[MODEM] Inicializando módem A7670 para activar GPS...");

  #ifdef BOARD_POWERON_PIN
    Serial.println("[MODEM] Activando pin de alimentación BOARD_POWERON_PIN...");
    pinMode(BOARD_POWERON_PIN, OUTPUT);
    digitalWrite(BOARD_POWERON_PIN, HIGH);
  #endif

  // Aplicar Reset físico si está definido
  #ifdef MODEM_RESET_PIN
    Serial.println("[MODEM] Aplicando pulso de Reset físico...");
    pinMode(MODEM_RESET_PIN, OUTPUT);
    digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL); delay(100);
    digitalWrite(MODEM_RESET_PIN, MODEM_RESET_LEVEL); delay(2600);
    digitalWrite(MODEM_RESET_PIN, !MODEM_RESET_LEVEL);
  #endif

  // Desactivar DTR para asegurar que el módem no entre en modo sleep
  #ifdef MODEM_DTR_PIN
    Serial.printf("[MODEM] Configurando DTR (Pin %d) a nivel BAJO...\n", MODEM_DTR_PIN);
    pinMode(MODEM_DTR_PIN, OUTPUT);
    digitalWrite(MODEM_DTR_PIN, LOW);
  #endif

  // Pulso de encendido en PWRKEY
  Serial.println("[MODEM] Enviando pulso de encendido en PWRKEY...");
  pinMode(BOARD_PWRKEY_PIN, OUTPUT);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);
  delay(100);
  digitalWrite(BOARD_PWRKEY_PIN, HIGH);
  delay(MODEM_POWERON_PULSE_WIDTH_MS);
  digitalWrite(BOARD_PWRKEY_PIN, LOW);

  // Esperar comunicación AT
  Serial.println("[MODEM] Probando comunicación con comandos AT...");
  int retry = 0;
  while (!modem.testAT(1000)) {
    Serial.print(".");
    if (retry++ > 25) {
      // Si no responde, reintentar pulso PWRKEY
      Serial.println("\n[MODEM] Reintentando pulso PWRKEY...");
      digitalWrite(BOARD_PWRKEY_PIN, LOW);
      delay(100);
      digitalWrite(BOARD_PWRKEY_PIN, HIGH);
      delay(MODEM_POWERON_PULSE_WIDTH_MS);
      digitalWrite(BOARD_PWRKEY_PIN, LOW);
      retry = 0;
    }
  }
  Serial.println("\n[MODEM] ¡Comunicación AT establecida exitosamente!");

  // Mostrar información del modelo
  String modemName = modem.getModemName();
  Serial.print("[MODEM] Modelo de hardware detectado: ");
  Serial.println(modemName);

  // Activar antena GNSS/GPS integrada
  Serial.println("[MODEM] Activando receptor GPS/GNSS...");
  int gpsRetry = 0;
  while (!modem.enableGPS(MODEM_GPS_ENABLE_GPIO, MODEM_GPS_ENABLE_LEVEL)) {
    Serial.print(".");
    delay(1000);
    gpsRetry++;
    if (gpsRetry > 10) {
      Serial.println("\n[WARNING] No se pudo activar el GPS en los primeros intentos, reintentando...");
      gpsRetry = 0;
    }
  }
  Serial.println("\n[MODEM] Módulo GPS/GNSS activado con éxito.");

  // Configurar velocidad del GPS
  modem.setGPSBaud(115200);
}

// --- LEER COORDENADAS GPS DEL MÓDEM ---
void readGPS() {
  float lat2 = 0.0;
  float lon2 = 0.0;
  float speed2 = 0.0;
  float alt2 = 0.0;
  int vsat2 = 0;
  int usat2 = 0;
  float accuracy2 = 0.0;
  int year2 = 0, month2 = 0, day2 = 0;
  int hour2 = 0, min2 = 0, sec2 = 0;
  uint8_t fixMode = 0;

  // Solicitar ubicación
  if (modem.getGPS(&fixMode, &lat2, &lon2, &speed2, &alt2, &vsat2, &usat2, &accuracy2,
                   &year2, &month2, &day2, &hour2, &min2, &sec2)) {
    latitude = lat2;
    longitude = lon2;
    gpsSpeed = speed2; // TinyGSM retorna km/h directamente para este módem

    Serial.print("[GPS] Lat: ");
    Serial.print(latitude, 6);
    Serial.print(" | Lng: ");
    Serial.print(longitude, 6);
    Serial.print(" | Speed: ");
    Serial.print(gpsSpeed, 1);
    Serial.print(" km/h | Mode: ");
    Serial.print(fixMode);
    Serial.print(" | Sat: ");
    Serial.println(vsat2);
  } else {
    Serial.println("[GPS] Buscando satélites (sitúe la antena GPS bajo cielo abierto)...");
  }
}

// --- ENVIAR TELEMETRÍA JSON POR EL CLIENTE TCP (WI-FI) ---
void sendTelemetry() {
  bool ignitionState = (digitalRead(PIN_IGNITION) == LOW);
  float batteryVolts = (analogRead(PIN_BAT_ADC) / 4095.0) * 2.0 * 3.3 * 1.1;

  // Construir JSON string terminando en salto de línea (\n)
  String json = "{";
  json += "\"imei\":\"" + imei + "\",";
  json += "\"lat\":" + String(latitude, 6) + ",";
  json += "\"lng\":" + String(longitude, 6) + ",";
  json += "\"ign\":" + String(ignitionState ? "true" : "false") + ",";
  json += "\"bat\":" + String(batteryVolts, 2) + ",";
  json += "\"speed\":" + String(gpsSpeed, 1) + ",";
  json += "\"outs\":[" + String(outputStates[0] ? "true" : "false") + "," + String(outputStates[1] ? "true" : "false") + "],";
  json += "\"rssi\":" + String(rssi);
  json += "}\n";

  Serial.print("[TCP Send] Transmitiendo JSON: ");
  Serial.print(json);

  // Enviar directamente al socket TCP por Wi-Fi
  tcpClient.print(json);
}

// --- ESCUCHAR COMANDOS TCP ENTRANTES POR WI-FI ---
void checkIncomingData() {
  while (tcpClient.available()) {
    String line = tcpClient.readStringUntil('\n');
    line.trim();

    if (line.length() > 0) {
      Serial.print("[TCP Recv] Comando recibido: ");
      Serial.println(line);
      handleCommand(line);
    }
  }
}

// --- PROCESAR COMANDO Y ENVIAR RESPUESTA ACK POR WI-FI ---
void handleCommand(const String& jsonCmd) {
  if (jsonCmd.indexOf("\"cmd\":\"set_output\"") != -1) {
    int idxPos = jsonCmd.indexOf("\"index\":");
    int index = 0;
    if (idxPos != -1) {
      index = jsonCmd.substring(idxPos + 8, idxPos + 9).toInt();
    }

    int statePos = jsonCmd.indexOf("\"state\":");
    bool state = false;
    if (statePos != -1) {
      String stateVal = jsonCmd.substring(statePos + 8);
      if (stateVal.startsWith("true") || stateVal.startsWith("1")) {
        state = true;
      }
    }

    // Cambiar estado físico de los pines
    if (index == 0) {
      digitalWrite(PIN_OUTPUT_1, state ? HIGH : LOW);
      outputStates[0] = state;
    } else if (index == 1) {
      digitalWrite(PIN_OUTPUT_2, state ? HIGH : LOW);
      outputStates[1] = state;
    }

    Serial.print("[OUTPUT] Salida ");
    Serial.print(index);
    Serial.println(state ? " ACTIVADA" : " DESACTIVADA");

    // Retornar ACK por el socket TCP de Wi-Fi
    String ackJson = "{\"imei\":\"" + imei + "\",\"cmd_ack\":\"set_output\",\"index\":" + String(index) + ",\"success\":true}\n";
    tcpClient.print(ackJson);
    Serial.println("[TCP Send] ACK de comando enviado.");
  }
  else if (jsonCmd.indexOf("\"cmd\":\"set_config\"") != -1) {
    int intPos = jsonCmd.indexOf("\"interval\":");
    if (intPos != -1) {
      String intVal = jsonCmd.substring(intPos + 11);
      int endChar = intVal.indexOf('}');
      if (endChar != -1) {
        intVal = intVal.substring(0, endChar);
      }
      intVal.trim();
      int val = intVal.toInt();
      if (val >= 5 && val <= 3600) {
        reportInterval = val;
        Serial.print("[CONFIG] Intervalo cambiado a: ");
        Serial.print(reportInterval);
        Serial.println("s");
      }
    }
  }
}
