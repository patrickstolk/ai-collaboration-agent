const manifestVersion=chrome.runtime.getManifest().version;document.getElementById("extensionVersion").textContent="v"+manifestVersion;
const $=id=>document.getElementById(id);
const DEFAULT_URL="http://10.170.50.26:8787";
function showStatus(message,ok=false){$("status").textContent=message;$("status").style.color=ok?"#16794b":"#b42318";}
async function verifyConnection(baseUrl,token){
 const response=await fetch(baseUrl+"/api/extension/health",{headers:{"X-Agent-Token":token},cache:"no-store"});
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(response.status===401?"Token ongeldig. Controleer AGENT_TOKEN in Portainer.":"Server antwoordt met HTTP "+response.status+".");
 if(!data.connected)throw Error("Server bevestigde de verbinding niet.");
 return data;
}
chrome.storage.local.get(["baseUrl","token"],async v=>{
 $("url").value=v.baseUrl||DEFAULT_URL;
 $("token").value=v.token||"";
 if(v.baseUrl&&v.token){
  try{await verifyConnection(v.baseUrl,v.token);showStatus("Verbonden met agent-server.",true);}
  catch(e){showStatus("Niet verbonden: "+e.message);}
 }else showStatus("Vul dashboard URL en token in.");
});
$("save").onclick=async()=>{
 const baseUrl=$("url").value.trim().replace(/\/$/,"");
 const token=$("token").value.trim();
 if(!baseUrl||!token){showStatus("Vul dashboard URL en token in.");return;}
 $("save").disabled=true;showStatus("Verbinding controleren…");
 try{
  await verifyConnection(baseUrl,token);
  await chrome.storage.local.set({baseUrl,token});
  chrome.runtime.sendMessage({type:"START"});
  showStatus("Verbonden — token geaccepteerd en agent bereikbaar.",true);
 }catch(e){showStatus("Verbinding mislukt: "+e.message);}
 finally{$("save").disabled=false;}
};
$("open").onclick=async()=>{
 await chrome.tabs.create({url:"https://claude.ai/"});
 await chrome.tabs.create({url:"https://chatgpt.com/"});
 showStatus("Websites geopend. Log in als dat nodig is.");
};
