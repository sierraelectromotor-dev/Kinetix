/**
 * Kinetix Tracker - Configuration File (WiFi & GPS Hybrid)
 * Archivo de configuración para firmware ESP32 + LilyGo T-Call A7670
 */

#ifndef CONFIG_H
#define CONFIG_H

// --- INFORMACIÓN DE DISPOSITIVO ---
#define DEVICE_IMEI "864205040001234"

// --- CONFIGURACIÓN DE CONECTIVIDAD WI-FI (PARA PRUEBAS) ---
#define WIFI_SSID "COVID19_2.4GHZ"
#define WIFI_PASS "1234567890"

// --- CONFIGURACIÓN DEL SERVIDOR VPS ---
#define SERVER_IP "192.168.1.100" // Cambiar por la IP pública de tu VPS
#define SERVER_PORT 5000         // Puerto TCP configurado en el backend Node.js

// --- CONFIGURACIÓN DE PINS DEL LILYGO T-CALL A7670 ---
#define MODEM_RX     26
#define MODEM_TX     27
#define MODEM_PWRKEY 4
#define MODEM_RST    5
#define MODEM_FLIGHT 12 

// --- CONFIGURACIÓN DE ENTRADAS Y SALIDAS AUTOMOTRICES ---
#define PIN_IGNITION 34 
#define PIN_OUTPUT_1 13 
#define PIN_OUTPUT_2 14 
#define PIN_BAT_ADC  35 

// --- PARÁMETROS OPERATIVOS ---
#define DEFAULT_REPORT_INTERVAL 10 // Reducido a 10s para pruebas más dinámicas en Wi-Fi

#endif // CONFIG_H
