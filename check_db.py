import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        # Consultar la tabla devices en PostgreSQL
        cmd = 'PGPASSWORD="kinetix_pass" psql -h localhost -U kinetix_user -d kinetix -c "SELECT * FROM devices;"'
        stdin, stdout, stderr = ssh.exec_command(cmd)
        print("=== DEVICES STDOUT ===")
        print(stdout.read().decode('utf-8'))
        print("=== DEVICES STDERR ===")
        print(stderr.read().decode('utf-8'))
        
        # Consultar la última telemetría
        cmd2 = 'PGPASSWORD="kinetix_pass" psql -h localhost -U kinetix_user -d kinetix -c "SELECT * FROM telemetry ORDER BY timestamp DESC LIMIT 10;"'
        stdin, stdout, stderr = ssh.exec_command(cmd2)
        print("=== TELEMETRY STDOUT ===")
        print(stdout.read().decode('utf-8'))
        print("=== TELEMETRY STDERR ===")
        print(stderr.read().decode('utf-8'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
