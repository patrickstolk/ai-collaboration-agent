FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
COPY static ./static
COPY start.sh /start.sh
RUN chmod 755 /start.sh && mkdir -p /data
EXPOSE 8000
CMD ["/start.sh"]
