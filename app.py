import os, asyncio, json, uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from dotenv import load_dotenv
from browser_agent import BrowserAgent

load_dotenv()
DB=os.getenv("DB_PATH","/data/browser-agent.json")
agent=BrowserAgent()
app=FastAPI(title="AI Collaboration Agent")
app.mount("/static",StaticFiles(directory="static"),name="static")
clients=set()
def now(): return datetime.now(timezone.utc).isoformat()
def read_db():
    os.makedirs(os.path.dirname(DB) or ".",exist_ok=True)
    if not os.path.exists(DB):
        with open(DB,"w") as f: json.dump({"tasks":[]},f)
    with open(DB,encoding="utf-8") as f: return json.load(f)
def write_db(d):
    with open(DB+".tmp","w",encoding="utf-8") as f: json.dump(d,f,ensure_ascii=False,indent=2)
    os.replace(DB+".tmp",DB)
def get_task(tid): return next((t for t in read_db()["tasks"] if t["id"]==tid),None)
def update(tid,**kw):
    d=read_db()
    for t in d["tasks"]:
        if t["id"]==tid: t.update(kw); t["updated_at"]=now(); break
    write_db(d)
async def broadcast(msg):
    for ws in list(clients):
        try: await ws.send_json(msg)
        except Exception: clients.discard(ws)
async def log(tid,msg,actor="orchestrator"):
    d=read_db()
    for t in d["tasks"]:
        if t["id"]==tid:
            t["events"].append({"at":now(),"actor":actor,"message":msg})
            t["updated_at"]=now()
            break
    write_db(d)
    await broadcast({"type":"update","task_id":tid})
class TaskIn(BaseModel):
    prompt:str=Field(min_length=3,max_length=15000)
    mode:Literal["automatic","parallel","claude_first","chatgpt_first"]="automatic"
class LoginIn(BaseModel):
    provider:Literal["claude","chatgpt"]
@app.get("/",response_class=HTMLResponse)
async def home():
    with open("static/index.html",encoding="utf-8") as f: return f.read()
@app.get("/api/health")
async def health(): return {"status":"ok"}
@app.get("/api/tasks")
async def tasks(): return sorted(read_db()["tasks"],key=lambda t:t["created_at"],reverse=True)[:100]
@app.get("/api/tasks/{tid}")
async def detail(tid):
    t=get_task(tid)
    if not t: raise HTTPException(404,"Taak niet gevonden")
    return t
@app.get("/api/browser-status")
async def browser_status(): return await agent.status()
@app.post("/api/browser/open")
async def browser_open():
    await agent.start()
    return {"ok":True,"message":"Browser gestart"}
@app.post("/api/browser/check")
async def browser_check(body:LoginIn): return await agent.check_login(body.provider)
@app.post("/api/tasks")
async def create(body:TaskIn):
    await agent.start()
    state=await agent.status()
    if not all(state[p]["logged_in"] for p in ("claude","chatgpt")):
        raise HTTPException(409,"Log eerst handmatig in op beide websites via Browserbeeld.")
    tid=str(uuid.uuid4())
    t={"id":tid,"prompt":body.prompt,"mode":body.mode,"status":"QUEUED","created_at":now(),"updated_at":now(),"claude_status":"IDLE","chatgpt_status":"IDLE","result":None,"error":None,"events":[]}
    d=read_db(); d["tasks"].append(t); write_db(d)
    await log(tid,"Opdracht ontvangen","user")
    asyncio.create_task(run_task(tid))
    return get_task(tid)
async def run_task(tid):
    t=get_task(tid); prompt=t["prompt"]; mode=t["mode"]
    try:
        update(tid,status="RUNNING"); await log(tid,"Opdracht gestart")
        if mode=="claude_first":
            update(tid,claude_status="RUNNING",chatgpt_status="WAITING")
            c=await agent.ask("claude",prompt)
            update(tid,claude_status="COMPLETED",chatgpt_status="RUNNING")
            final=await agent.ask("chatgpt","Controleer en verbeter dit antwoord. Opdracht:\n"+prompt+"\nAntwoord Claude:\n"+c)
            update(tid,chatgpt_status="COMPLETED")
        elif mode=="chatgpt_first":
            update(tid,chatgpt_status="RUNNING",claude_status="WAITING")
            g=await agent.ask("chatgpt",prompt)
            update(tid,chatgpt_status="COMPLETED",claude_status="RUNNING")
            final=await agent.ask("claude","Controleer en verbeter dit antwoord. Opdracht:\n"+prompt+"\nAntwoord ChatGPT:\n"+g)
            update(tid,claude_status="COMPLETED")
        else:
            update(tid,claude_status="RUNNING",chatgpt_status="RUNNING")
            results=await asyncio.gather(agent.ask("claude",prompt),agent.ask("chatgpt",prompt),return_exceptions=True)
            c=results[0] if not isinstance(results[0],Exception) else "[Claude-fout: "+str(results[0])+"]"
            g=results[1] if not isinstance(results[1],Exception) else "[ChatGPT-fout: "+str(results[1])+"]"
            update(tid,claude_status="FAILED" if c.startswith("[Claude-fout") else "COMPLETED",chatgpt_status="FAILED" if g.startswith("[ChatGPT-fout") else "COMPLETED")
            if c.startswith("[Claude-fout") and g.startswith("[ChatGPT-fout"): raise RuntimeError(c+"; "+g)
            try:
                final=await agent.ask("chatgpt","Combineer de antwoorden tot één eindresultaat en benoem relevante verschillen.\nOPDRACHT:\n"+prompt+"\nCLAUDE:\n"+c+"\nCHATGPT:\n"+g) if not g.startswith("[ChatGPT-fout") else "Claude:\n"+c+"\nChatGPT:\n"+g
            except Exception: final="Claude:\n"+c+"\nChatGPT:\n"+g
        update(tid,status="COMPLETED",result=final)
        await log(tid,"Opdracht afgerond")
        await broadcast({"type":"completed","task_id":tid})
    except Exception as e:
        update(tid,status="FAILED",error=str(e))
        await log(tid,"Opdracht mislukt: "+str(e))
        await broadcast({"type":"failed","task_id":tid})
@app.websocket("/ws")
async def ws(ws:WebSocket):
    await ws.accept(); clients.add(ws)
    try:
        while True: await ws.receive_text()
    except WebSocketDisconnect: clients.discard(ws)
@app.on_event("shutdown")
async def shutdown(): await agent.close()
