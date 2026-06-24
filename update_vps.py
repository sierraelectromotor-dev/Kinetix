import sys
import io
import paramiko

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        stdin, stdout, stderr = ssh.exec_command("cd /var/www/Kinetix && git pull && pm2 restart kinetix-telematics")
        print(stdout.read().decode('utf-8', errors='ignore'))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
