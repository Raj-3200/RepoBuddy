"""GitHub OAuth sign-in endpoints.

Flow (popup):
1. Frontend opens popup -> GET /api/auth/github/login
2. Backend 302-redirects to https://github.com/login/oauth/authorize
3. User approves -> GitHub redirects to GET /api/auth/github/callback?code=...
4. Backend exchanges code -> access_token, then returns a tiny HTML page that
   `window.opener.postMessage({ type: "github-oauth", token, user }, "*")`
   and closes itself. The frontend's opener listens for the message.
"""

from __future__ import annotations

import secrets
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from app.config import get_settings

router = APIRouter()


def _oauth_configured() -> bool:
    s = get_settings()
    return bool(s.github_oauth_client_id.strip() and s.github_oauth_client_secret.strip())


@router.get("/github/status")
async def github_status() -> JSONResponse:
    s = get_settings()
    cid = s.github_oauth_client_id.strip()
    return JSONResponse(
        {
            "configured": _oauth_configured(),
            "client_id": cid or None,
        }
    )


@router.get("/github/login")
async def github_login(request: Request) -> RedirectResponse:
    s = get_settings()
    if not _oauth_configured():
        raise HTTPException(
            status_code=503,
            detail=(
                "GitHub OAuth is not configured. Set GITHUB_OAUTH_CLIENT_ID "
                "and GITHUB_OAUTH_CLIENT_SECRET in the backend .env."
            ),
        )

    state = secrets.token_urlsafe(24)
    # Store state in a short-lived signed cookie so the callback can verify it.
    params = {
        "client_id": s.github_oauth_client_id.strip(),
        "redirect_uri": s.github_oauth_redirect_uri.strip(),
        "scope": "repo read:user user:email",
        "state": state,
        "allow_signup": "true",
    }
    authorize_url = f"https://github.com/login/oauth/authorize?{urlencode(params)}"
    response = RedirectResponse(authorize_url, status_code=302)
    response.set_cookie(
        "gh_oauth_state",
        state,
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return response


_CALLBACK_HTML = """<!doctype html>
<html><head><meta charset="utf-8"><title>GitHub sign-in</title>
<style>
 body{{font-family:system-ui,sans-serif;background:#0b0b10;color:#e7e7ea;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
 .card{{background:#16161d;border:1px solid #26262f;border-radius:12px;
        padding:28px 32px;max-width:420px;text-align:center}}
 h1{{font-size:16px;margin:0 0 8px}} p{{font-size:13px;color:#9aa}}
 .err{{color:#ff7676}}
</style></head>
<body><div class="card">
  <h1>{title}</h1>
  <p class="{klass}">{body}</p>
</div>
<script>
(function() {{
  var payload = {payload_json};
  try {{
    if (window.opener) {{
      window.opener.postMessage(payload, "*");
    }}
  }} catch (e) {{}}
  setTimeout(function() {{
    if (window.opener) window.close();
    else window.location.replace({frontend_url_json} + "/signin");
  }}, {close_delay_ms});
}})();
</script>
</body></html>
"""


def _callback_response(
    *,
    title: str,
    body: str,
    payload: dict,
    frontend_url: str,
    is_error: bool = False,
) -> HTMLResponse:
    import json as _json

    html = _CALLBACK_HTML.format(
        title=title,
        body=body,
        klass="err" if is_error else "",
        payload_json=_json.dumps(payload),
        frontend_url_json=_json.dumps(frontend_url),
        close_delay_ms=2500 if is_error else 400,
    )
    return HTMLResponse(html)


@router.get("/github/callback")
async def github_callback(
    request: Request,
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
    error_description: str | None = Query(None),
) -> HTMLResponse:
    s = get_settings()
    cookie_state = request.cookies.get("gh_oauth_state")

    if error:
        return _callback_response(
            title="Sign-in cancelled",
            body=error_description or error,
            payload={"type": "github-oauth", "error": error_description or error},
            frontend_url=s.frontend_url,
            is_error=True,
        )

    if not code or not state or state != cookie_state:
        return _callback_response(
            title="Sign-in failed",
            body="Invalid state. Please try again.",
            payload={"type": "github-oauth", "error": "invalid_state"},
            frontend_url=s.frontend_url,
            is_error=True,
        )

    if not _oauth_configured():
        return _callback_response(
            title="Not configured",
            body="GitHub OAuth is not configured on the server.",
            payload={"type": "github-oauth", "error": "not_configured"},
            frontend_url=s.frontend_url,
            is_error=True,
        )

    async with httpx.AsyncClient(timeout=15.0) as client:
        # 1) Exchange code for access token
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": s.github_oauth_client_id.strip(),
                "client_secret": s.github_oauth_client_secret.strip(),
                "code": code,
                "redirect_uri": s.github_oauth_redirect_uri.strip(),
            },
        )
        if token_res.status_code != 200:
            return _callback_response(
                title="Sign-in failed",
                body=f"GitHub returned {token_res.status_code} on token exchange.",
                payload={"type": "github-oauth", "error": "token_exchange_failed"},
                frontend_url=s.frontend_url,
                is_error=True,
            )
        token_data = token_res.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return _callback_response(
                title="Sign-in failed",
                body=token_data.get("error_description") or "No access token returned.",
                payload={
                    "type": "github-oauth",
                    "error": token_data.get("error", "no_token"),
                },
                frontend_url=s.frontend_url,
                is_error=True,
            )

        # 2) Fetch the user profile
        user_res = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )
        user = user_res.json() if user_res.status_code == 200 else {}

    payload = {
        "type": "github-oauth",
        "token": access_token,
        "user": {
            "login": user.get("login"),
            "name": user.get("name"),
            "email": user.get("email"),
            "avatar_url": user.get("avatar_url"),
        },
    }
    response = _callback_response(
        title="Signed in",
        body="You can close this window.",
        payload=payload,
        frontend_url=s.frontend_url,
    )
    response.delete_cookie("gh_oauth_state")
    return response
