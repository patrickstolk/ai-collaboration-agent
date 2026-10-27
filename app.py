from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
app=FastAPI(title='AI Collaboration Agent')
app.mount('/static',StaticFiles(directory='static'),name='static')
@app.get('/',response_class=HTMLResponse)
def home():
    with open('static/index.html',encoding='utf-8') as f:
        return f.read()
@app.get('/api/health')
def health():
    return {'status':'ok'}
