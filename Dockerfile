FROM mcr.microsoft.com/playwright/python:v1.52.0-noble
ENV PYTHONUNBUFFERED=1 DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox dbus-x11 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# Base image includes Debian-managed Python packages without pip RECORD metadata.
# --ignore-installed avoids pip failing while trying to uninstall typing_extensions.
RUN pip install --no-cache-dir --ignore-installed -r requirements.txt
COPY app.py browser_agent.py ./
COPY static ./static
COPY start.sh /start.sh
RUN chmod +x /start.sh && mkdir -p /data
EXPOSE 8000 6080
CMD ["/start.sh"]
