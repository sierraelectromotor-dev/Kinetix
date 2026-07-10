import paramiko

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

FILES_TO_UPLOAD = [
    ("backend/src/index.js", "/var/www/Kinetix/backend/src/index.js"),
    ("backend/public/index.html", "/var/www/Kinetix/backend/public/index.html"),
    ("backend/public/style.css", "/var/www/Kinetix/backend/public/style.css"),
    ("backend/public/app.js", "/var/www/Kinetix/backend/public/app.js")
]

def main():
    print(f"Connecting to VPS {VPS_IP}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        print("Connected! Uploading files via SFTP...")
        
        sftp = ssh.open_sftp()
        for local, remote in FILES_TO_UPLOAD:
            print(f"Uploading {local} to {remote}...")
            sftp.put(local, remote)
        sftp.close()
        print("All files uploaded successfully!")
        
        print("Restarting kinetix-telematics in PM2...")
        stdin, stdout, stderr = ssh.exec_command("pm2 restart kinetix-telematics")
        print("PM2 STDOUT:")
        out_str = stdout.read().decode('utf-8', errors='replace')
        print(out_str.encode('ascii', errors='replace').decode('ascii'))
        print("PM2 STDERR:")
        err_str = stderr.read().decode('utf-8', errors='replace')
        print(err_str.encode('ascii', errors='replace').decode('ascii'))
        
        print("Deployment finished successfully!")
    except Exception as e:
        print(f"Deployment failed: {e}")
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
