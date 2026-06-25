/**
 * Kinetix Tracker - Configuration File (WiFi & GPS Hybrid)
 * Archivo de configuración para firmware ESP32 + LilyGo T-Call A7670
 */

#ifndef CONFIG_H
#define CONFIG_H

// --- INFORMACIÓN DE DISPOSITIVO ---
#define DEVICE_IMEI "869469087955339"

// --- CONFIGURACIÓN DE CONECTIVIDAD CELULAR (CLARO COLOMBIA) ---
#define CELL_APN  "internet.comcel.com.co"
#define CELL_USER "comcelweb"
#define CELL_PASS "comcelweb"

// --- CONFIGURACIÓN DEL SERVIDOR VPS ---
#define SERVER_IP "187.77.3.156" // Cambiar por la IP pública de tu VPS
#define SERVER_PORT 5000         // Puerto TCP configurado en el backend Node.js



// --- CONFIGURACIÓN DE ENTRADAS Y SALIDAS AUTOMOTRICES ---
#define PIN_IGNITION 34 
#define PIN_OUTPUT_1 13 
#define PIN_OUTPUT_2 14 
#define PIN_BAT_ADC  35 

// --- PARÁMETROS OPERATIVOS ---
#define DEFAULT_REPORT_INTERVAL 10 // Reducido a 10s para pruebas más dinámicas en Wi-Fi

#endif // CONFIG_H
