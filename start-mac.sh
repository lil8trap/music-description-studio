#!/usr/bin/env bash
# Restart the three local services from this project, then verify each port.
set -e

project_dir="$(cd "$(dirname "$0")" && pwd -P)"
log_dir="$project_dir/run-logs"
mkdir -p "$log_dir"

fail() { printf 'Music Studio: %s\n' "$1" >&2; exit 1; }
for tool in lsof curl mvn npm; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is missing. See README.md for setup."
done
[ -x "$project_dir/backend/.venv/bin/python" ] || fail "Python environment is missing. See README.md for first-time setup."
[ -x "$project_dir/frontend/node_modules/.bin/vite" ] || fail "Frontend dependencies are missing. Run 'cd frontend && npm install' first."

# Existing projects need this one new dependency for reliable MP3 decoding.
if ! "$project_dir/backend/.venv/bin/python" -c 'import imageio_ffmpeg' >/dev/null 2>&1; then
    printf 'Installing the bundled audio decoder in this project...\n'
    "$project_dir/backend/.venv/bin/python" -m pip install 'imageio-ffmpeg>=0.5,<1' || \
        fail "Could not install the audio decoder. Check your internet connection and retry."
fi

service_pids=""
check_owner() {
    service_pid="$1"
    expected_dir="$2"
    actual_dir="$(lsof -a -p "$service_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    [ "$actual_dir" = "$project_dir/$expected_dir" ] || fail "PID $service_pid is using a project port or database from a different folder ($actual_dir). Stop it manually before starting this project."
    service_pids="$service_pids $service_pid"
}

# Inspect every listener before stopping anything. Never stop another project's process.
for port_and_dir in '8000 backend' '8080 server' '5173 frontend'; do
    set -- $port_and_dir
    port="$1"
    expected_dir="$2"
    for service_pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
        check_owner "$service_pid" "$expected_dir"
    done
done
if [ -f "$project_dir/server/music-library.mv.db" ]; then
    for service_pid in $(lsof -t "$project_dir/server/music-library.mv.db" 2>/dev/null || true); do
        check_owner "$service_pid" server
    done
fi

for service_pid in $service_pids; do
    kill "$service_pid" 2>/dev/null || true
done

# Give Spring time to release the H2 file lock before starting a new JVM.
ports_released() {
    for port in 8000 8080 5173; do
        [ -z "$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)" ] || return 1
    done
    if [ -f "$project_dir/server/music-library.mv.db" ]; then
        [ -z "$(lsof -t "$project_dir/server/music-library.mv.db" 2>/dev/null || true)" ] || return 1
    fi
    return 0
}
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    ports_released && break
    sleep 1
done
ports_released || fail "A port or the music database is still in use. Close the old service terminal and retry."

cd "$project_dir/backend"
nohup .venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 > "$log_dir/python.log" 2>&1 < /dev/null &
python_pid=$!
cd "$project_dir/server"
nohup mvn spring-boot:run > "$log_dir/spring.log" 2>&1 < /dev/null &
spring_pid=$!
cd "$project_dir/frontend"
nohup npm run dev -- --strictPort > "$log_dir/frontend.log" 2>&1 < /dev/null &
frontend_pid=$!

printf 'Starting Python, Spring Boot, and React. Checking ports...\n'
ready=0
for attempt in $(seq 1 60); do
    if curl --max-time 2 -fsS http://127.0.0.1:8000/api/health >/dev/null 2>&1 && \
       curl --max-time 2 -fsS http://127.0.0.1:8080/api/tracks >/dev/null 2>&1 && \
       curl --max-time 2 -fsS http://127.0.0.1:5173/ >/dev/null 2>&1; then
        ready=1
        break
    fi
    for service_pid in "$python_pid" "$spring_pid" "$frontend_pid"; do
        kill -0 "$service_pid" 2>/dev/null || break 2
    done
    sleep 1
done

if [ "$ready" -eq 1 ]; then
    printf '\nAll three services are ready. Open http://127.0.0.1:5173\n'
    printf 'To stop them later, run: bash "%s/stop-mac.sh"\n' "$project_dir"
else
    printf '\nA service did not start. Recent logs:\n' >&2
    for name in python spring frontend; do
        printf '\n--- %s ---\n' "$name" >&2
        tail -n 20 "$log_dir/$name.log" >&2
    done
    exit 1
fi
