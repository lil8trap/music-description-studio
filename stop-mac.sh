#!/usr/bin/env bash
set -e
project_dir="$(cd "$(dirname "$0")" && pwd -P)"
for port_and_dir in '8000 backend' '8080 server' '5173 frontend'; do
    set -- $port_and_dir
    port="$1"
    expected_dir="$project_dir/$2"
    for service_pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
        actual_dir="$(lsof -a -p "$service_pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
        if [ "$actual_dir" = "$expected_dir" ]; then
            kill "$service_pid" 2>/dev/null || true
            printf 'Stopped project service on port %s.\n' "$port"
        else
            printf 'Left port %s alone (different project: %s).\n' "$port" "$actual_dir"
        fi
    done
done
