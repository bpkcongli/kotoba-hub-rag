from pathlib import Path
import json
import os
import platform
import socket
import subprocess
import tempfile
import time
import urllib.request


base = Path(__file__).resolve().parent
spike = base / 'spike'
node_bin = base / 'node-v24.22.3-linux-x64/bin'

env = dict(os.environ, PATH=str(node_bin) + os.pathsep + os.environ['PATH'])
env['npm_config_cache'] = str(base / 'npm-cache')

results = []


def run(args):
    start = time.monotonic()
    result = subprocess.run(args, cwd=spike, env=env, capture_output=True, text=True)

    record = {
        'argv': args,
        'exit_code': result.returncode,
        'duration_seconds': round(time.monotonic() - start, 3),
        'stdout': result.stdout,
        'stderr': result.stderr,
    }
    results.append(record)
    print(' '.join(args), '=>', result.returncode, flush=True)

    if result.returncode:
        print(result.stdout, result.stderr, flush=True)
        raise RuntimeError('Spike command failed')

    return result


def free_port():
    with socket.socket() as server:
        server.bind(('127.0.0.1', 0))
        return server.getsockname()[1]


observed = {
    'python': platform.python_version(),
    'architecture': platform.machine(),
    'container_limits': {},
}

for name in ('memory.max', 'cpu.max', 'memory.peak'):
    path = Path('/sys/fs/cgroup') / name
    if path.exists():
        observed['container_limits'][name] = path.read_text().strip()

server_proc = None
qdrant_peak_kib = None

try:
    run(['node', '--version'])
    run(['npm', '--version'])
    run(['npm', 'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'])

    run(['npm', 'run', 'typecheck'])
    run(['npm', 'run', 'lint'])
    run(['npm', 'run', 'format:check'])
    run(['npm', 'run', 'build'])

    with tempfile.TemporaryDirectory(prefix='qdrant-data-', dir=base) as data:
        folder = Path(data)
        port = free_port()
        config = folder / 'config.yaml'

        config.write_text(f'''log_level: WARN
telemetry_disabled: true
storage:
  storage_path: {folder / 'storage'}
  snapshots_path: {folder / 'snapshots'}
service:
  host: 127.0.0.1
  http_port: {port}
  grpc_port: null
  enable_cors: false
''')

        with (base / 'qdrant-spike.log').open('w') as log:
            server_proc = subprocess.Popen(
                [str(base / 'qdrant-bin/qdrant'), '--config-path', str(config)],
                cwd=folder,
                stdout=log,
                stderr=subprocess.STDOUT,
                env=env,
            )

            ready_by = time.monotonic() + 30
            endpoint = f'http://127.0.0.1:{port}'

            while True:
                try:
                    with urllib.request.urlopen(endpoint + '/readyz', timeout=1) as response:
                        if response.status == 200:
                            break
                except Exception:
                    if server_proc.poll() is not None or time.monotonic() > ready_by:
                        raise RuntimeError(
                            'Temporary Qdrant did not become ready; inspect qdrant-spike.log'
                        )
                    time.sleep(0.1)

            with urllib.request.urlopen(endpoint, timeout=2) as response:
                observed['qdrant'] = json.load(response)

            env['DEC01_QDRANT_URL'] = endpoint
            run(['node', '--test', '.out/spike.test.js'])

            status = Path(f'/proc/{server_proc.pid}/status')
            if status.exists():
                for line in status.read_text().splitlines():
                    if line.startswith('VmHWM:'):
                        qdrant_peak_kib = int(line.split()[1])

            server_proc.terminate()
            server_proc.wait(timeout=10)
            server_proc = None

    run(['npm', 'ls', '--depth=0', '--json'])

finally:
    if server_proc is not None:
        server_proc.terminate()
        server_proc.wait(timeout=10)

    observed['qdrant_process_peak_rss_kib'] = qdrant_peak_kib

    for name in ('memory.max', 'cpu.max', 'memory.peak'):
        path = Path('/sys/fs/cgroup') / name
        if path.exists():
            observed['container_limits'][name] = path.read_text().strip()

    (base / 'spike-results.json').write_text(
        json.dumps({'environment': observed, 'commands': results}, indent=2) + '\n'
    )
