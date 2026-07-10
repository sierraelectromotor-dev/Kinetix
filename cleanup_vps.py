import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        # Kill python test_tcp.py
        print("Killing any test_tcp.py processes on VPS...")
        ssh.exec_command("pkill -f test_tcp.py")
        
        # Remove file
        print("Removing /tmp/test_tcp.py...")
        ssh.exec_command("rm -f /tmp/test_tcp.py")
        
        # Start PM2
        print("Starting PM2 kinetix-telematics...")
        stdin, stdout, stderr = ssh.exec_command("pm2 start kinetix-telematics")
        print(stdout.read().decode('utf-8'))
        
        # Show PM2 list
        stdin, stdout, stderr = ssh.exec_command("pm2 list")
        print("=== PM2 STATUS ===")
        print(stdout.read().decode('utf-8'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
