#!/bin/bash
set -e
export DISPLAY=:99
Xvfb :99 -screen 0 1600x1000x24 -ac +extension GLX +render -noreset >/tmp/xvfb.log 2>&1 &
sleep 1
fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display :99 -forever -shared -nopw -rfbport 5900 >/tmp/x11vnc.log 2>&1 &
websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/tmp/websockify.log 2>&1 &
exec uvicorn app:app --host 0.0.0.0 --port 8000
