import os,asyncio,json,uuid,secrets,urllib.request
from datetime import datetime,timezone
from typing import Literal
from fastapi import FastAPI,HTTPException,WebSocket,WebSocketDisconnect,Header
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel,Field
from dotenv import load_dotenv
load_dotenv()
DB=os.getenv("DB_PATH","/data/browser-agent.json")
AGENT_TOKEN=os.getenv("AGENT_TOKEN","please-change-this-token")
app=FastAPI(title="AI Collaboration Agent")
app.mount("/static",StaticFiles(directory="static"),name="static")
clients=set()
def now(): return datetime.now(timezone.utc).isoformat()
def read_db():
 os.makedirs(os.path.dirname(DB) or ".",exist_ok=True)
 if not os.path.exists(DB):
  with open(DB,"w") as f: json.dump({"tasks":[]},f)
 with open(DB,encoding="utf-8") as f:return json.load(f)
def write_db(d):
 with open(DB+".tmp","w",encoding="utf-8") as f:json.dump(d,f,ensure_ascii=False,indent=2)
 os.replace(DB+".tmp",DB)
def get_task(tid):return next((t for t in read_db()["tasks"] if t["id"]==tid),None)
def update(tid,**kw):
 d=read_db()
 for t in d["tasks"]:
  if t["id"]==tid:t.update(kw);t["updated_at"]=now();break
 write_db(d)
async def broadcast(msg):
 for ws in list(clients):
  try:await ws.send_json(msg)
  except Exception:clients.discard(ws)
async def log(tid,msg,actor="orchestrator"):
 d=read_db()
 for t in d["tasks"]:
  if t["id"]==tid:t["events"].append({"at":now(),"actor":actor,"message":msg});t["updated_at"]=now();break
 write_db(d);await broadcast({"type":"update","task_id":tid})
def auth(token):
 if not secrets.compare_digest(token or "",AGENT_TOKEN):raise HTTPException(401,"Ongeldige agent-token")
class TaskIn(BaseModel):
 prompt:str=Field(min_length=3,max_length=15000)
 mode:Literal["automatic","parallel","claude_first","chatgpt_first"]="automatic"
class ResultIn(BaseModel):
 provider:Literal["claude","chatgpt"]
 text:str=Field(min_length=1,max_length=50000)
 error:str|None=None
@app.get("/",response_class=HTMLResponse)
async def home():
 with open("static/index.html",encoding="utf-8") as f:return f.read()
@app.get("/api/health")
async def health():return {"status":"ok","mode":"local-browser-extension"}

def fetch_provider_status(url):
 try:
  req=urllib.request.Request(url,headers={"User-Agent":"AI-Collaboration-Agent status-check"})
  with urllib.request.urlopen(req,timeout=5) as response:
   payload=json.loads(response.read().decode("utf-8"))
  status=payload.get("status",{})
  return {"ok":True,"indicator":status.get("indicator","unknown"),"description":status.get("description","Status onbekend"),"updated_at":payload.get("page",{}).get("updated_at")}
 except Exception as exc:
  return {"ok":False,"indicator":"unknown","description":"Statuspagina niet bereikbaar","error":str(exc)}

@app.get("/api/status")
async def status():
 claude,chatgpt=await asyncio.gather(
  asyncio.to_thread(fetch_provider_status,"https://status.claude.com/api/v2/status.json"),
  asyncio.to_thread(fetch_provider_status,"https://status.openai.com/api/v2/status.json"))
 return {"checked_at":now(),"server":{"status":"ok","description":"Agent API bereikbaar"},"providers":{"claude":claude,"chatgpt":chatgpt},"browser_extension":{"status":"unknown","description":"De browserextensie meldt momenteel geen heartbeat; controleer de extensie en ingelogde tabbladen."}}
@app.get("/api/tasks")
async def tasks():return sorted(read_db()["tasks"],key=lambda t:t["created_at"],reverse=True)[:100]
@app.get("/api/tasks/{tid}")
async def detail(tid):
 t=get_task(tid)
 if not t:raise HTTPException(404,"Taak niet gevonden")
 return t
@app.post("/api/tasks")
async def create(body:TaskIn):
 tid=str(uuid.uuid4());t={"id":tid,"prompt":body.prompt,"mode":body.mode,"status":"QUEUED","created_at":now(),"updated_at":now(),"claude_status":"QUEUED","chatgpt_status":"QUEUED","results":{},"result":None,"error":None,"events":[],"next_provider":"claude"}
 d=read_db();d["tasks"].append(t);write_db(d);await log(tid,"Opdracht in wachtrij; lokale browserextensie voert deze uit.","user");return get_task(tid)
@app.get("/api/extension/health")
async def extension_health(x_agent_token:str|None=Header(default=None)):
 auth(x_agent_token)
 return {"status":"ok","connected":True,"message":"Token geldig; extensie kan de agent bereiken."}

@app.get("/api/extension/next")
async def extension_next(x_agent_token:str|None=Header(default=None)):
 auth(x_agent_token)
 d=read_db()
 for t in d["tasks"]:
  if t["status"] not in ("QUEUED","RUNNING"):continue
  mode=t["mode"];results=t.get("results",{})
  needed=["claude","chatgpt"]
  if mode=="claude_first":needed=["claude","chatgpt"]
  elif mode=="chatgpt_first":needed=["chatgpt","claude"]
  remaining=[p for p in needed if p not in results]
  if not remaining:
   if mode in ("automatic","parallel") and "synthesis" not in results:
    t["status"]="SYNTHESIS";t["next_provider"]="chatgpt";t["updated_at"]=now();write_db(d)
    return {"task_id":t["id"],"provider":"chatgpt","prompt":"Maak een eindantwoord op basis van de opdracht en beide antwoorden. Benoem relevante verschillen en verzin geen feiten.\nOPDRACHT:\n"+t["prompt"]+"\nCLAUDE:\n"+results["claude"]+"\nCHATGPT:\n"+results["chatgpt"],"stage":"synthesis"}
   t["status"]="COMPLETED";t["result"]=results.get("synthesis") or results.get(needed[-1]) or results.get(needed[0]);t["updated_at"]=now();write_db(d);continue
  provider=remaining[0];t["status"]="RUNNING";t[provider+"_status"]="RUNNING";t["updated_at"]=now();write_db(d)
  prompt=t["prompt"]
  if len(results):
   previous=next(iter(results.values()))
   prompt=("Controleer en verbeter het eerdere antwoord. Opdracht:\n"+t["prompt"]+"\nEerder antwoord:\n"+previous) if mode in ("claude_first","chatgpt_first") else prompt
  return {"task_id":t["id"],"provider":provider,"prompt":prompt,"stage":"answer"}
 return {"task_id":None}
@app.post("/api/extension/result/{tid}")
async def extension_result(tid:str,body:ResultIn,x_agent_token:str|None=Header(default=None)):
 auth(x_agent_token);t=get_task(tid)
 if not t:raise HTTPException(404,"Taak niet gevonden")
 d=read_db()
 for item in d["tasks"]:
  if item["id"]==tid:
   if body.error:
    item[body.provider+"_status"]="FAILED";item["error"]=body.provider+": "+body.error;item["status"]="FAILED"
   else:
    item["results"][ "synthesis" if item.get("status")=="SYNTHESIS" else body.provider]=body.text
    item[body.provider+"_status"]="COMPLETED"
    if item["mode"] in ("claude_first","chatgpt_first") and len(item["results"])>=2:
     item["status"]="COMPLETED";item["result"]=body.text
    elif item["mode"]=="parallel" and len(item["results"])>=2:
     item["status"]="RUNNING"
    elif item["mode"]=="automatic" and len(item["results"])>=2:
     item["status"]="RUNNING"
   item["updated_at"]=now();item["events"].append({"at":now(),"actor":body.provider,"message":"Antwoord ontvangen." if not body.error else "Fout: "+body.error})
   break
 write_db(d);await broadcast({"type":"update","task_id":tid})
 if get_task(tid)["status"]=="COMPLETED":await broadcast({"type":"completed","task_id":tid})
 if get_task(tid)["status"]=="FAILED":await broadcast({"type":"failed","task_id":tid})
 return get_task(tid)
@app.websocket("/ws")
async def ws(ws:WebSocket):
 await ws.accept();clients.add(ws)
 try:
  while True:await ws.receive_text()
 except WebSocketDisconnect:clients.discard(ws)
