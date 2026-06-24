import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        print("=== STDOUT LOGS ===")
        stdin, stdout, stderr = ssh.exec_command("tail -n 50 /root/.pm2/logs/kinetix-telematics-out.log")
        print(stdout.read().decode('utf-8', errors='ignore'))
        
        print("=== STDERR LOGS ===")
        stdin, stdout, stderr = ssh.exec_command("tail -n 50 /root/.pm2/logs/kinetix-telematics-error.log")
        print(stdout.read().decode('utf-8', errors='ignore'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
