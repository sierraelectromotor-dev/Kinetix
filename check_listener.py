import paramiko

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect('187.77.3.156', username='root', password='H36&WE1iv&Sierra&', timeout=10)
        
        print("=== PM2 OUT LOG ===")
        stdin, stdout, stderr = ssh.exec_command('tail -n 100 /root/.pm2/logs/kinetix-telematics-out.log')
        print(stdout.read().decode('utf-8', errors='replace'))
        print("=== PM2 ERROR LOG ===")
        stdin, stdout, stderr = ssh.exec_command('tail -n 100 /root/.pm2/logs/kinetix-telematics-error.log')
        print(stdout.read().decode('utf-8', errors='replace'))
        
    except Exception as e:
        print(f"Error: {e}")
    finally:
        ssh.close()

if __name__ == '__main__':
    main()
