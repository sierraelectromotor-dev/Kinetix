import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        # Leer las últimas 30 líneas del archivo de salida
        stdin, stdout, stderr = ssh.exec_command("tail -n 30 /root/.pm2/logs/kinetix-telematics-out-4.log || tail -n 30 /root/.pm2/logs/kinetix-telematics-out.log")
        print("=== OUT LOG ===")
        print(stdout.read().decode('utf-8', errors='ignore'))
        
        stdin, stdout, stderr = ssh.exec_command("tail -n 30 /root/.pm2/logs/kinetix-telematics-error-4.log || tail -n 30 /root/.pm2/logs/kinetix-telematics-error.log")
        print("=== ERROR LOG ===")
        print(stdout.read().decode('utf-8', errors='ignore'))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
