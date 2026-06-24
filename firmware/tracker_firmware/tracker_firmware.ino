/**
 * Kinetix Tracker - Firmware ESP32 (Híbrido WiFi + GPS)
 * 
 * Este programa utiliza el Wi-Fi del ESP32 para conectarse al servidor TCP de la VPS,
 * y en paralelo se comunica con el módem A7670 por puerto Serial para activar y leer
 * la antena GPS integrada, simulando el funcionamiento final sin necesidad de tarjeta SIM.
 */

#include <Arduino.h>
#include <WiFi.h>
#include <HardwareSerial.h>
#include "config.h"

// Instancia de Puerto Serial para comunicarse con el A7670 (Comandos AT del GPS)
HardwareSerial SerialAT(1);

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
bool sendATCommand(const String& cmd, uint32_t timeout, const char* expected_resp = "OK", String* responseOut = nullptr);
void readGPS();
void sendTelemetry();
void checkIncomingData();
void handleCommand(const String& jsonCmd);
double convertNmeaToDecimal(String value, char direction);

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n--- RASTREADOR KINETIX (MODO DE PRUEBA WIFI + GPS) ---");

  // Configurar pines de Entradas/Salidas
  pinMode(PIN_IGNITION, INPUT_PULLUP);
  pinMode(PIN_OUTPUT_1, OUTPUT);
  pinMode(PIN_OUTPUT_2, OUTPUT);
  
  digitalWrite(PIN_OUTPUT_1, LOW);
  digitalWrite(PIN_OUTPUT_2, LOW);

  // Iniciar conexión Wi-Fi
  connectToWiFi();

  // Iniciar comunicación Serial con el A7670
  SerialAT.begin(115200, SERIAL_8N1, MODEM_RX, MODEM_TX);
  delay(500);

  // Encender el módem A7670 solo para activar la antena GPS (GNSS)
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

  // Leer coordenadas de la antena GPS del módem A7670
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
  
  pinMode(MODEM_FLIGHT, OUTPUT);
  digitalWrite(MODEM_FLIGHT, HIGH);
  
  pinMode(MODEM_PWRKEY, OUTPUT);
  pinMode(MODEM_RST, OUTPUT);
  
  // Pulso de encendido
  digitalWrite(MODEM_RST, HIGH);
  digitalWrite(MODEM_PWRKEY, HIGH);
  delay(100);
  digitalWrite(MODEM_PWRKEY, LOW);
  delay(1500);
  digitalWrite(MODEM_PWRKEY, HIGH);
  
  delay(6000); // Esperar encendido básico

  // Probar comunicación AT
  int retries = 5;
  while (retries > 0) {
    if (sendATCommand("AT", 1000)) break;
    delay(1000);
    retries--;
  }

  sendATCommand("ATE0", 1000);      // Desactivar eco
  
  // Activar antena GNSS/GPS
  Serial.println("[MODEM] Activando módulo GPS (GNSS)...");
  sendATCommand("AT+CGNSSPWR=1", 2000);
}

// --- ENVIAR COMANDOS AT AL MÓDEM ---
bool sendATCommand(const String& cmd, uint32_t timeout, const char* expected_resp, String* responseOut) {
  while (SerialAT.available()) { SerialAT.read(); }

  SerialAT.println(cmd);
  
  String response = "";
  unsigned long startTime = millis();
  
  while (millis() - startTime < timeout) {
    while (SerialAT.available()) {
      char c = SerialAT.read();
      response += c;
    }
    if (response.indexOf(expected_resp) != -1) {
      break;
    }
    delay(10);
  }

  if (responseOut != nullptr) {
    *responseOut = response;
  }

  return (response.indexOf(expected_resp) != -1);
}

// --- LEER COORDENADAS GPS DEL MÓDEM ---
void readGPS() {
  String resp;
  if (sendATCommand("AT+CGNSSINFO", 1000, "OK", &resp)) {
    int index = resp.indexOf("+CGNSSINFO:");
    if (index != -1) {
      String data = resp.substring(index);
      data.replace("\r", "");
      data.replace("\n", "");
      
      int commaIndex = 0;
      String fields[14];
      for (int i = 0; i < 14; i++) {
        int nextComma = data.indexOf(',', commaIndex);
        if (nextComma != -1) {
          fields[i] = data.substring(commaIndex, nextComma);
          commaIndex = nextComma + 1;
        } else {
          fields[i] = data.substring(commaIndex);
          break;
        }
      }

      fields[0].replace("+CGNSSINFO: ", "");
      fields[0].trim();

      // Si el módem tiene fijación de satélites
      if (fields[0] != "0" && fields[0] != "" && fields[4] != "" && fields[6] != "") {
        latitude = convertNmeaToDecimal(fields[4], fields[5][0]);
        longitude = convertNmeaToDecimal(fields[6], fields[7][0]);
        
        if (fields[11] != "") {
          gpsSpeed = fields[11].toFloat() * 1.852; // Nudos a km/h
        } else {
          gpsSpeed = 0.0;
        }
        
        Serial.print("[GPS] Lat: ");
        Serial.print(latitude, 6);
        Serial.print(" | Lng: ");
        Serial.print(longitude, 6);
        Serial.print(" | Speed: ");
        Serial.print(gpsSpeed, 1);
        Serial.println(" km/h");
      } else {
        Serial.println("[GPS] Buscando satélites (Coloca la antena GPS cerca de una ventana)...");
      }
    }
  }
}

// --- CONVERTIR COORDENADAS NMEA A GRADOS DECIMALES ---
double convertNmeaToDecimal(String value, char direction) {
  int dotIndex = value.indexOf('.');
  if (dotIndex == -1) return 0.0;

  String minStr = value.substring(dotIndex - 2);
  String degStr = value.substring(0, dotIndex - 2);

  double degrees = degStr.toFloat();
  double minutes = minStr.toFloat();

  double decimal = degrees + (minutes / 60.0);

  if (direction == 'S' || direction == 'W') {
    decimal = -decimal;
  }

  return decimal;
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
