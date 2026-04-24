#!/usr/bin/env bash
# Oracle Cloud VM bootstrap for RepoBuddy.
# Tested on Oracle Linux 9 / Ubuntu 22.04 (Ampere A1).
#
# Usage (fresh VM, as ubuntu/opc user):
#   curl -fsSL https://raw.githubusercontent.com/<you>/RepoBuddy/main/deploy/bootstrap.sh | bash
#
# Or clone first then run:
#   git clone https://github.com/<you>/RepoBuddy.git && cd RepoBuddy
#   bash deploy/bootstrap.sh

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/YOUR_USER/RepoBuddy.git}"
REPO_DIR="${REPO_DIR:-$HOME/RepoBuddy}"

log() { printf '\n\033[1;34m[bootstrap]\033[0m %s\n' "$*"; }

# ── OS detection ─────────────────────────────────────────────────────────────
if [[ -f /etc/os-release ]]; then
	. /etc/os-release
	OS_ID="${ID:-unknown}"
else
	OS_ID="unknown"
fi

log "Detected OS: $OS_ID"

# ── Install Docker ───────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
	log "Installing Docker"
	case "$OS_ID" in
		ubuntu|debian)
			sudo apt-get update
			sudo apt-get install -y ca-certificates curl gnupg git
			sudo install -m 0755 -d /etc/apt/keyrings
			curl -fsSL https://download.docker.com/linux/"$OS_ID"/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
			sudo chmod a+r /etc/apt/keyrings/docker.gpg
			echo \
				"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/$OS_ID \
				$(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
				sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
			sudo apt-get update
			sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
			;;
		ol|rhel|centos|rocky|almalinux)
			sudo dnf install -y dnf-plugins-core git
			sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
			sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
			sudo systemctl enable --now docker
			;;
		*)
			echo "Unsupported OS: $OS_ID — install Docker manually and re-run."
			exit 1
			;;
	esac
	sudo usermod -aG docker "$USER"
	log "Docker installed. You may need to log out and back in for group membership."
fi

# ── Firewall (open 80/443) ───────────────────────────────────────────────────
log "Opening ports 80/443"
if command -v firewall-cmd >/dev/null 2>&1; then
	sudo firewall-cmd --permanent --add-service=http || true
	sudo firewall-cmd --permanent --add-service=https || true
	sudo firewall-cmd --reload || true
fi
if command -v ufw >/dev/null 2>&1; then
	sudo ufw allow 80/tcp || true
	sudo ufw allow 443/tcp || true
fi
# Oracle Linux also uses iptables directly; persist rules.
if command -v iptables >/dev/null 2>&1; then
	sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT || true
	sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT || true
	if command -v netfilter-persistent >/dev/null 2>&1; then
		sudo netfilter-persistent save || true
	elif [[ -d /etc/iptables ]]; then
		sudo sh -c 'iptables-save > /etc/iptables/rules.v4' || true
	fi
fi

# ── Clone repo ───────────────────────────────────────────────────────────────
if [[ ! -d "$REPO_DIR/.git" ]]; then
	log "Cloning $REPO_URL → $REPO_DIR"
	git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# ── .env bootstrap ──────────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
	log "Creating .env from .env.example — EDIT IT NOW before first start."
	cp .env.example .env
	cat <<'EOF' >> .env

# ── Oracle VM deploy extras (fill these in) ──
API_DOMAIN=api.yourdomain.com
ACME_EMAIL=you@yourdomain.com
EOF
	echo ""
	echo "  >>> Edit $REPO_DIR/.env (set APP_SECRET_KEY, API_DOMAIN, ACME_EMAIL, CORS_ORIGINS,"
	echo "      DATABASE_URL, OPENAI_API_KEY, etc.) then re-run this script."
	exit 0
fi

# ── Start stack ──────────────────────────────────────────────────────────────
log "Building + starting stack"
sudo docker compose -f deploy/docker-compose.oracle.yml pull || true
sudo docker compose -f deploy/docker-compose.oracle.yml up -d --build

log "Done. Checking status..."
sudo docker compose -f deploy/docker-compose.oracle.yml ps

cat <<EOF

Next steps:
  1. Point DNS A-record for \$API_DOMAIN at this VM's public IP.
  2. Wait ~30 seconds for Caddy to get a Let's Encrypt cert.
  3. curl -sS https://\$API_DOMAIN/health   # should return {"status":"ok"}
  4. In Vercel, set VITE_API_URL=https://\$API_DOMAIN/api and redeploy.
  5. Add the Vercel domain to CORS_ORIGINS in .env and restart backend.

Logs:
  sudo docker compose -f deploy/docker-compose.oracle.yml logs -f backend
EOF
