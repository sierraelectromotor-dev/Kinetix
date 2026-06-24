-- Esquema de Base de Datos para Kinetix Tracking System

-- Habilitar extensión UUID si es necesaria
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tabla de Dispositivos (Devices)
CREATE TABLE IF NOT EXISTS devices (
    imei VARCHAR(20) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    plate VARCHAR(20),
    description TEXT,
    config JSONB DEFAULT '{"interval": 30, "speed_limit": 100}'::jsonb,
    is_online BOOLEAN DEFAULT false,
    last_seen TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Telemetría (Telemetry)
CREATE TABLE IF NOT EXISTS telemetry (
    id BIGSERIAL PRIMARY KEY,
    imei VARCHAR(20) NOT NULL REFERENCES devices(imei) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    ignition BOOLEAN NOT NULL DEFAULT false,
    battery NUMERIC(4, 2), -- Voltaje de la batería (ej. 3.70 - 4.20)
    speed NUMERIC(5, 2) DEFAULT 0.00, -- Velocidad en km/h
    outputs BOOLEAN[] NOT NULL DEFAULT ARRAY[false, false], -- Array de salidas [Salida1, Salida2]
    rssi INTEGER, -- Calidad de señal celular
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Índice compuesto para búsquedas rápidas de histórico por dispositivo ordenado por tiempo
CREATE INDEX IF NOT EXISTS idx_telemetry_imei_timestamp ON telemetry(imei, timestamp DESC);

-- 3. Tabla de Comandos (Commands)
CREATE TABLE IF NOT EXISTS commands (
    id SERIAL PRIMARY KEY,
    imei VARCHAR(20) NOT NULL REFERENCES devices(imei) ON DELETE CASCADE,
    command VARCHAR(50) NOT NULL,
    parameters JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(20) DEFAULT 'pending', -- pending, sent, acknowledged, failed
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP WITH TIME ZONE,
    responded_at TIMESTAMP WITH TIME ZONE
);

-- Seed opcional de dispositivos de prueba
INSERT INTO devices (imei, name, plate, description, config)
VALUES 
('864205040001234', 'Camioneta Reparto 1', 'ABC-123', 'Toyota Hilux Blanca', '{"interval": 15, "speed_limit": 90}'),
('864205040005678', 'Moto Entrega 2', 'XYZ-789', 'Yamaha FZ16 Negra', '{"interval": 10, "speed_limit": 80}')
ON CONFLICT (imei) DO NOTHING;
