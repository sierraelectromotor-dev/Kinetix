import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        stdin, stdout, stderr = ssh.exec_command("cat /root/.pm2/logs/kinetix-telematics-out-4.log || cat /root/.pm2/logs/kinetix-telematics-out.log")
        content = stdout.read().decode('utf-8', errors='ignore')
        
        # Split by the restart signature and get the last chunk
        chunks = content.split("[PostgreSQL] Conexin establecida con la base de datos")
        if len(chunks) > 1:
            recent_logs = chunks[-1]
        else:
            recent_logs = content
            
        print("=== RECENT OUT LOGS ===")
        print(recent_logs.encode('ascii', errors='ignore').decode('ascii'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
