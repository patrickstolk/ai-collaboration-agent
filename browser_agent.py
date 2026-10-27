import os, asyncio
from playwright.async_api import async_playwright

class BrowserAgent:
    def __init__(self):
        self.pw=None; self.contexts={}; self.pages={}; self.lock=asyncio.Lock()
        self.profiles={'claude':'/data/profiles/claude','chatgpt':'/data/profiles/chatgpt'}
        self.urls={'claude':'https://claude.ai/','chatgpt':'https://chatgpt.com/'}
    async def start(self):
        async with self.lock:
            if self.pw and len(self.pages)==2: return
            self.pw=await async_playwright().start()
            for name in ('claude','chatgpt'):
                if name in self.pages: continue
                os.makedirs(self.profiles[name],exist_ok=True)
                ctx=await self.pw.chromium.launch_persistent_context(self.profiles[name],headless=False,no_viewport=True,args=['--no-sandbox','--disable-dev-shm-usage'])
                self.contexts[name]=ctx
                page=ctx.pages[0] if ctx.pages else await ctx.new_page()
                self.pages[name]=page
                if page.url=='about:blank': await page.goto(self.urls[name],wait_until='domcontentloaded',timeout=60000)
    async def check_login(self,name):
        await self.start(); page=self.pages[name]; logged=False
        try:
            selectors=['div[contenteditable="true"]','textarea'] if name=='claude' else ['#prompt-textarea','div[contenteditable="true"]','textarea']
            logged=any([await page.locator(s).count()>0 for s in selectors]) and name in page.url
        except Exception: pass
        return {'provider':name,'logged_in':bool(logged),'url':page.url,'message':'Sessie lijkt klaar.' if logged else 'Controleer handmatig of je bent ingelogd.'}
    async def status(self):
        result={}
        for name in ('claude','chatgpt'):
            page=self.pages.get(name)
            if not page: result[name]={'page_open':False,'logged_in':False,'url':None}
            else:
                check=await self.check_login(name)
                result[name]={'page_open':not page.is_closed(),'logged_in':check['logged_in'],'url':page.url}
        return result
    async def ask(self,name,prompt):
        await self.start(); page=self.pages[name]
        if page.is_closed(): raise RuntimeError('Browservenster is gesloten.')
        check=await self.check_login(name)
        if not check['logged_in']: raise RuntimeError('Log handmatig in via Browserbeeld en probeer opnieuw.')
        inputs=['div[contenteditable="true"]','textarea'] if name=='claude' else ['#prompt-textarea','div[contenteditable="true"]','textarea']
        send=['button[aria-label*="Send"]','button[data-testid*="send"]']
        answer=['[data-testid*="message-content"]','.font-claude-message'] if name=='claude' else ['[data-message-author-role="assistant"]','.markdown']
        field=None
        for selector in inputs:
            try:
                item=page.locator(selector).last
                if await item.count() and await item.is_visible(): field=item; break
            except Exception: pass
        if field is None: raise RuntimeError('Invoerveld niet gevonden; website-interface kan veranderd zijn.')
        await field.click(); await field.fill(prompt)
        sent=False
        for selector in send:
            try:
                button=page.locator(selector).last
                if await button.count() and await button.is_visible() and await button.is_enabled(): await button.click(); sent=True; break
            except Exception: pass
        if not sent: await field.press('Enter')
        deadline=asyncio.get_running_loop().time()+int(os.getenv('ANSWER_TIMEOUT_SECONDS','240'))
        previous=''; stable=0
        while asyncio.get_running_loop().time()<deadline:
            await asyncio.sleep(2); candidates=[]
            for selector in answer:
                try:
                    loc=page.locator(selector); n=await loc.count()
                    for i in range(max(0,n-4),n):
                        value=(await loc.nth(i).inner_text(timeout=1200)).strip()
                        if value: candidates.append(value)
                except Exception: pass
            if candidates:
                latest=max(candidates,key=len)
                stable=stable+1 if latest==previous and len(latest)>10 else 0; previous=latest
                if stable>=2: return latest
        raise RuntimeError('Geen stabiel antwoord ontvangen; controleer het browservenster.')
    async def close(self):
        for ctx in self.contexts.values():
            try: await ctx.close()
            except Exception: pass
        if self.pw: await self.pw.stop()
