const AI_AGENT_CONTENT_VERSION="1.0.2";
(function showAgentVersionBadge(){
 const id="ai-collaboration-agent-version";
 function mount(){
  if(!document.documentElement||document.getElementById(id))return;
  const badge=document.createElement("div");
  badge.id=id;
  badge.textContent="AI Agent ext v"+chrome.runtime.getManifest().version+" · script v"+AI_AGENT_CONTENT_VERSION;
  badge.title="Versie van de browserextensie en het content script dat op deze pagina geladen is";
  badge.style.cssText="position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#111827;color:#fff;border:1px solid #64748b;border-radius:7px;padding:6px 9px;font:11px/1.3 system-ui,sans-serif;opacity:.88;box-shadow:0 2px 10px #0005;pointer-events:none";
  document.documentElement.appendChild(badge);
 }
 mount();
 if(!document.getElementById(id))setTimeout(mount,1500);
})();
chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=="RUN_PROMPT")return;runPrompt(message.prompt).then(text=>reply({text})).catch(e=>reply({error:String(e)}));return true});const sleep=ms=>new Promise(r=>setTimeout(r,ms));async function runPrompt(prompt){const isClaude=location.hostname.includes("claude.ai");const inputSelectors=isClaude?['div[contenteditable="true"]','[contenteditable="true"]','textarea']:['#prompt-textarea','div[contenteditable="true"]','textarea'];let input=null;for(const sel of inputSelectors){const list=[...document.querySelectorAll(sel)];input=list.find(e=>e.offsetParent!==null);if(input)break}if(!input)throw Error("Invoerveld niet gevonden. Log in en controleer de website.");input.focus();if(input.tagName==="TEXTAREA"||input.tagName==="INPUT"){const proto=input.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const setter=Object.getOwnPropertyDescriptor(proto,"value").set;setter.call(input,prompt);input.dispatchEvent(new Event("input",{bubbles:true}));}else{input.textContent=prompt;input.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:prompt}));}await sleep(500);const before=collectAnswers(isClaude);const beforeLast=before[before.length-1]||"";const buttons=isClaude?['button[aria-label*="Send"]','button[aria-label*="send"]','button[type="submit"]']:['button[data-testid="send-button"]','button[aria-label*="Send"]'];let sent=false;for(const sel of buttons){const b=[...document.querySelectorAll(sel)].find(x=>x.offsetParent!==null&&!x.disabled);if(b){b.click();sent=true;break}}if(!sent){input.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",bubbles:true}));input.dispatchEvent(new KeyboardEvent("keyup",{key:"Enter",code:"Enter",bubbles:true}));}const deadline=Date.now()+240000;let last="",stable=0;while(Date.now()<deadline){await sleep(2000);const answers=collectAnswers(isClaude);const current=answers[answers.length-1]||"";const stop=[...document.querySelectorAll('button[aria-label*="Stop"],button[aria-label*="stop"],button[data-testid*="stop"]')].some(b=>b.offsetParent!==null&&!b.disabled);if(current.trim().length>0&&current===last&&!stop)stable++;else stable=0;last=current;if(stable>=3&&(answers.length>before.length||current!==beforeLast))return current}
 // Final recovery: on ChatGPT the answer may be visible even if its usual message selector changes.
 if(!isClaude){const recovered=extractLatestAssistantText();if(recovered&&(recovered!==beforeLast||collectAnswers(false).length>before.length))return recovered}
 throw Error("Geen stabiel antwoord ontvangen binnen 4 minuten.")}function collectAnswers(claude){
 const selectors=claude
  ? ['[data-testid="chat-message-content"]','[data-testid*="message-content"]','.font-claude-message','[data-testid*="assistant-message"]','[data-testid*="assistant"] main p']
  : ['[data-message-author-role="assistant"]','[data-testid*="conversation-turn"] [data-message-author-role="assistant"]','main article [data-message-author-role="assistant"]'];
 for(const sel of selectors){
  const values=[...document.querySelectorAll(sel)].filter(e=>e.offsetParent!==null&&!e.closest('[data-testid*="user"],[data-testid*="human"]')).map(e=>e.innerText.trim()).filter(Boolean);
  if(values.length)return claude?[...new Set(values)]:values;
 }
 // Fallback for changing site markup: inspect visible conversation text, excluding the prompt form and user messages.
 const fallback=[...document.querySelectorAll('main [data-message-author-role="assistant"], main p, main [dir="auto"]')]
  .filter(e=>e.offsetParent!==null&&!e.closest('form,[contenteditable="true"],textarea,[data-testid*="user"],[data-testid*="human"]'))
  .map(e=>e.innerText.trim())
  .filter(t=>t&&t.length<50000);
 if(fallback.length)return [...new Set(fallback)];
 return [];
}
function extractLatestAssistantText(){
 const selectors=['[data-message-author-role="assistant"]','[data-testid*="conversation-turn"]','[data-message-id]','main article','.markdown'];
 for(const sel of selectors){
  const nodes=[...document.querySelectorAll(sel)].filter(e=>e.offsetParent!==null);
  const texts=nodes.map(e=>e.innerText.trim()).filter(t=>t&&t.length<50000);
  if(texts.length){const unique=[...new Set(texts)];return unique[unique.length-1]}
 }
 const main=document.querySelector('main');
 if(!main)return "";
 const text=main.innerText.trim();
 if(!text)return "";
 const lines=text.split("\n").map(x=>x.trim()).filter(Boolean);
 return lines.slice(-20).join("\n");
}
