# AI Collaboration Agent — Local browser edition

The dashboard runs on Unraid/Portainer. Claude.ai and ChatGPT.com run in your own local Edge/Chrome browser, controlled by an unpacked browser extension. No API keys and no noVNC desktop are needed.

## 1. Portainer
1. Set the environment variable `AGENT_TOKEN` to a long random secret in the Portainer stack. Do not keep the example value.
2. Deploy/redeploy the stack from this repository, branch `main`, compose path `docker-compose.yml`.
3. Open the dashboard at `http://SERVER-IP:8787` (or your configured Traefik URL).

## 2. Install the extension in Edge
1. Download the repository ZIP from GitHub and extract it on your PC.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the `extension` folder from the extracted repository.
5. Click the extension icon. Enter the dashboard URL and the exact same `AGENT_TOKEN` value used in Portainer, then click **Opslaan en verbinden**.
6. Click **Open Claude + ChatGPT** and sign in to both sites if needed.

Chrome users can use `chrome://extensions` instead.

## 3. Use it
Open the dashboard, submit an instruction, and leave Edge running with the extension enabled. The extension polls the dashboard for tasks, sends prompts in the local website tabs, and posts the responses back. For browser notifications, allow notifications from the dashboard site if prompted.

## Security and limitations
- The extension can interact with Claude and ChatGPT pages you are signed into. Keep the extension folder and token private.
- Use a strong token and keep the dashboard behind LAN/VPN or your existing authentication. Do not expose it publicly without additional access controls.
- Website DOM changes can break automation. If an input or send button is not detected, check the browser tab and extension console.
- Respect website terms and do not bypass CAPTCHA or access controls.
- The package image is built for linux/amd64.
