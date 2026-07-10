import paramiko
import time

VPS_IP = "187.77.3.156"
VPS_USER = "root"
VPS_PASS = "H36&WE1iv&Sierra&"

TEST_SERVER_CODE = """
import socket
import datetime
import sys

def main():
    s = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        s.bind(('::', 5000))
        s.listen(5)
        print("Python TCP Server listening on port 5000...", flush=True)
        
        while True:
            try:
                conn, addr = s.accept()
                now = datetime.datetime.utcnow().isoformat()
                print(f"[{now}] Connection accepted from: {addr}", flush=True)
                conn.settimeout(10.0)
                try:
                    data = conn.recv(1024)
                    now_recv = datetime.datetime.utcnow().isoformat()
                    if data:
                        print(f"[{now_recv}] Received {len(data)} bytes: {data}", flush=True)
                    else:
                        print(f"[{now_recv}] Received EOF (Connection closed by client).", flush=True)
                except socket.timeout:
                    print(f"[{datetime.datetime.utcnow().isoformat()}] Timeout waiting for data.", flush=True)
                except Exception as e:
                    print(f"[{datetime.datetime.utcnow().isoformat()}] Connection error: {e}", flush=True)
                finally:
                    conn.close()
                    print(f"[{datetime.datetime.utcnow().isoformat()}] Connection closed.", flush=True)
            except Exception as e:
                print(f"Accept error: {e}", flush=True)
    except Exception as e:
        print(f"Server error: {e}", flush=True)
    finally:
        s.close()

if __name__ == "__main__":
    main()
"""

def safe_print(text):
    print(text.encode('ascii', errors='ignore').decode('ascii'))

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        print("Connecting to VPS...")
        ssh.connect(VPS_IP, username=VPS_USER, password=VPS_PASS, timeout=15)
        
        print("Stopping PM2 kinetix-telematics...")
        ssh.exec_command("pm2 stop kinetix-telematics")
        time.sleep(2)
        
        # Write test server script on VPS
        print("Writing test server script on VPS...")
        sftp = ssh.open_sftp()
        with sftp.open("/tmp/test_tcp.py", "w") as f:
            f.write(TEST_SERVER_CODE)
        sftp.close()
        
        # Run test server in background
        print("Running test server in background...")
        ssh.exec_command("nohup python3 /tmp/test_tcp.py > /tmp/test_tcp.log 2>&1 &")
        
        print("Waiting 30 seconds for tracker connections...")
        for i in range(30):
            time.sleep(1)
            if i % 5 == 0:
                print(f"Elapsed: {i}s")
                
        # Kill the background process
        print("Killing test_tcp.py process on VPS...")
        ssh.exec_command("pkill -f test_tcp.py")
        time.sleep(1)
        
        # Read the log file
        print("Reading /tmp/test_tcp.log...")
        stdin, stdout, stderr = ssh.exec_command("cat /tmp/test_tcp.log")
        log_content = stdout.read().decode('utf-8', errors='ignore')
        
        print("\n=== TEST SERVER LOG ===")
        safe_print(log_content)
        print("=======================\n")
        
        # Clean up files
        print("Removing temporary files on VPS...")
        ssh.exec_command("rm -f /tmp/test_tcp.py /tmp/test_tcp.log")
        
        # Restart PM2
        print("Restarting PM2 kinetix-telematics...")
        stdin, stdout, stderr = ssh.exec_command("pm2 start kinetix-telematics")
        time.sleep(1)
        
        # Show status
        stdin, stdout, stderr = ssh.exec_command("pm2 list")
        print("=== PM2 STATUS ===")
        safe_print(stdout.read().decode('utf-8'))
        
    except Exception as e:
        print(f"Error during test: {e}")
        try:
            print("Ensuring PM2 is started...")
            ssh.exec_command("pm2 start kinetix-telematics")
        except:
            pass
    finally:
        ssh.close()

if __name__ == "__main__":
    main()
