# AI Collaboration Agent — Portainer / GHCR

Browser-based collaboration between Claude.ai and ChatGPT.com without API keys. You log in manually using the visible browser desktop.

## Publish
The GitHub Actions workflow builds and publishes `ghcr.io/patrickstolk/ai-collaboration-agent:latest` on pushes to the default branch. After the first successful workflow, open GitHub **Packages** and make the container package **Public** if Portainer should pull it without registry credentials.

## Portainer
1. Stacks → Add stack → Repository.
2. Repository: https://github.com/patrickstolk/ai-collaboration-agent
3. Branch: main; compose path: docker-compose.yml.
4. Deploy.

The included Traefik labels are examples. Set APP_DOMAIN and adapt the network and entrypoint to your actual Traefik setup. The compose publishes port 6080 for the browser desktop; do not expose it to the public internet.

## First login
Open the dashboard on port 8787, click Browsers openen, then open http://SERVER-IP:6080/vnc.html?autoconnect=1&resize=scale. Log in manually to Claude and ChatGPT, then use Controleer sessie.

## Security
- Port 6080 grants access to authenticated browser sessions. Restrict it to LAN/VPN.
- Browser profiles and task history live in the agent_data Docker volume.
- No API keys are required. Website UI automation can break when sites change; respect website terms and never bypass CAPTCHA or access controls.
- Image build targets linux/amd64.
