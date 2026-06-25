import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        stdin, stdout, stderr = ssh.exec_command("pm2 list")
        print("=== PM2 LIST ===")
        print(stdout.read().decode('utf-8'))
        print("=== STDERR ===")
        print(stderr.read().decode('utf-8'))
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
