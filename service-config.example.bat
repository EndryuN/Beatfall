@echo off
:: copy to service-config.bat (gitignored) and fill in.
:: generate a key:  python -c "import secrets; print(secrets.token_urlsafe(32))"
set API_KEY=
set CORS_ORIGINS=http://localhost:5173,https://musiclabs.uk
