import sys
import io
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    print("=== INICIANDO DIAGNÓSTICO EN LA VPS ===")
    
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        print("[SSH] Conectado exitosamente.")
    except Exception as e:
        print(f"[ERROR] Conexión SSH fallida: {e}")
        sys.exit(1)
        
    def run_cmd(title, cmd):
        print(f"\n--- {title} ---")
        print(f"[VPS] Ejecutando: {cmd}")
        stdin, stdout, stderr = ssh.exec_command(cmd)
        exit_status = stdout.channel.recv_exit_status()
        out = stdout.read().decode('utf-8', errors='ignore').strip()
        err = stderr.read().decode('utf-8', errors='ignore').strip()
        
        if out:
            print(f"[STDOUT]\n{out}")
        if err:
            print(f"[STDERR]\n{err}")
        print(f"[STATUS] Código de salida: {exit_status}")

    try:
        # 1. Check PostgreSQL system status
        run_cmd("Estado del servicio PostgreSQL", "systemctl status postgresql")
        
        # 2. Check if pg is listening and active
        run_cmd("Puertos de red activos (5432 / 8080 / 5000)", "ss -tuln")
        
        # 3. Check logs of PM2 application
        run_cmd("Logs recientes de PM2", "pm2 logs kinetix-telematics --lines 60 --no-colors")
        
        # 4. Check contents of devices table
        run_cmd("Contenido de la tabla 'devices'", 'su - postgres -c "psql -d kinetix -c \'SELECT * FROM devices;\'"')
        
    except Exception as ex:
        print(f"[ERROR] Error durante diagnóstico: {ex}")
    finally:
        ssh.close()
        print("\n[SSH] Conexión cerrada.")

if __name__ == "__main__":
    main()
