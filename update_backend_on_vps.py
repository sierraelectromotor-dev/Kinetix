import paramiko
import os

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

LOCAL_FILE = r"c:\Users\SierraElectromotor\Documents\Kinetix\backend\src\index.js"
REMOTE_FILE = "/var/www/Kinetix/backend/src/index.js"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Connecting to VPS via SSH...")
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        print("Uploading index.js using SFTP...")
        sftp = ssh.open_sftp()
        sftp.put(LOCAL_FILE, REMOTE_FILE)
        sftp.close()
        print("Upload complete.")
        
        print("Restarting backend PM2 process...")
        stdin, stdout, stderr = ssh.exec_command("pm2 restart all")
        print("=== PM2 RESTART STDOUT ===")
        print(stdout.read().decode('utf-8', errors='ignore'))
        print("=== PM2 RESTART STDERR ===")
        print(stderr.read().decode('utf-8', errors='ignore'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
