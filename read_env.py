import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        # Encontrar la carpeta de la app y leer el .env
        stdin, stdout, stderr = ssh.exec_command("find / -name \".env\" -path \"*/Kinetix/*\" 2>/dev/null || find / -name \".env\" 2>/dev/null")
        files = stdout.read().decode('utf-8').splitlines()
        print("=== .env files found ===")
        for f in files:
            print(f)
            stdin2, stdout2, stderr2 = ssh.exec_command(f"cat {f}")
            print(stdout2.read().decode('utf-8'))
            print("-----------------------")
            
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
