# Deploy Ready2Build to Azure App Service

## 1. Build the zip (on your dev machine)

From `Ready2Build_Deploy_Code`:

```powershell
.\build_deploy.ps1
```

This creates `deploy.zip` with `app/`, `static/`, `requirements.txt`, `startup.sh`, and `runtime.txt`.

**Do not** commit or deploy `.env` — configure Snowflake credentials in Azure App Settings instead.

## 2. One-time App Service configuration

**Recommended** (pre-built Python deps in zip — avoids 4+ minute Oryx pip and CLI timeout):

```powershell
az webapp config appsettings set `
  --name Ready2Build-App `
  --resource-group RG-ETL-CodeAnalyzerConverter `
  --settings `
    SCM_DO_BUILD_DURING_DEPLOYMENT=false `
    ENABLE_ORYX_BUILD=false `
    WEBSITE_ENABLE_SYNC_UPDATE_SITE=false `
    WEBSITES_PORT=8000 `
    SNOWFLAKE_ACCOUNT=your_account `
    SNOWFLAKE_USER=your_user `
    SNOWFLAKE_PASSWORD=your_password `
    SNOWFLAKE_WAREHOUSE=CORTEX_ANALYST_DEV_WH `
    SNOWFLAKE_DATABASE=CLEAR_TO_BUILD_DEV `
    SNOWFLAKE_SCHEMA=INFORMATION_MART `
    SNOWFLAKE_ROLE=your_role

az webapp config set `
  --name Ready2Build-App `
  --resource-group RG-ETL-CodeAnalyzerConverter `
  --startup-file "bash startup.sh"
```

Ensure the App Service **runtime stack** is **Python 3.11** (Linux).

## 3. Deploy

From `Ready2Build_Deploy_Code` (after `.\build_deploy.ps1`):

```powershell
.\deploy_azure.ps1
```

This uses `--async true` so the Azure CLI returns immediately instead of waiting on a **230-second gateway limit** while Oryx runs `pip install`.

Optional first-time clean deploy:

```powershell
.\deploy_azure.ps1 -Clean
```

Manual equivalent:

```powershell
az webapp deploy `
  --name Ready2Build-App `
  --resource-group RG-ETL-CodeAnalyzerConverter `
  --src-path "C:\Users\yaswa\Ready_To_Build_Dev\Ready2Build_Deploy_Code\deploy.zip" `
  --type zip `
  --async true
```

Poll until status is success:

```powershell
az webapp log deployment show `
  --name Ready2Build-App `
  --resource-group RG-ETL-CodeAnalyzerConverter
```

Or open: https://ready2build-app.scm.azurewebsites.net/api/deployments

## 4. Build succeeds but deploy "times out" (504 / hangs 4+ minutes)

This is **expected** when `SCM_DO_BUILD_DURING_DEPLOYMENT=true` and Azure runs `pip install` for `snowflake-connector-python` on the server. The deploy often **still completes** on Azure even when the CLI errors.

**Fix (recommended):**

1. Rebuild with bundled Linux wheels (done automatically by `.\build_deploy.ps1`):
   ```powershell
   .\build_deploy.ps1
   ```
   This adds `.python_packages/` (~80 MB) so Azure does **not** need to pip install at deploy time.

2. Turn off remote build:
   ```powershell
   az webapp config appsettings set `
     --name Ready2Build-App `
     --resource-group RG-ETL-CodeAnalyzerConverter `
     --settings SCM_DO_BUILD_DURING_DEPLOYMENT=false ENABLE_ORYX_BUILD=false WEBSITE_ENABLE_SYNC_UPDATE_SITE=false
   ```

3. Deploy async:
   ```powershell
   .\deploy_azure.ps1
   ```

4. Wait 2–3 minutes, then check `/health`.

If you still use remote build, use `.\deploy_azure.ps1` (async) and ignore CLI timeout — check Kudu deployments page for actual status.

## 5. If deployment returns 400

1. **Check Kudu logs**  
   https://ready2build-app.scm.azurewebsites.net/api/deployments/latest

2. **Stream deployment log**
   ```powershell
   az webapp log deployment show `
     --name Ready2Build-App `
     --resource-group RG-ETL-CodeAnalyzerConverter
   ```

3. **Common fixes**
   - `SCM_DO_BUILD_DURING_DEPLOYMENT=true` so `pip install -r requirements.txt` runs on deploy
   - `startup-file` set to `bash startup.sh`
   - `WEBSITES_PORT=8000` matches uvicorn port in `startup.sh`
   - Copy the **latest** `deploy.zip` from `Ready2Build_Deploy_Code` (not an old copy)
   - Use `--clean true` on redeploy

4. **Snowflake connector build failure**  
   If Oryx fails installing `snowflake-connector-python`, check the Kudu log for pip errors. You may need a larger App Service plan or to enable build logs:
   ```powershell
   az webapp log config --name Ready2Build-App --resource-group RG-ETL-CodeAnalyzerConverter --application-logging filesystem --level information
   ```

## 6. Verify

```powershell
curl.exe https://ready2build-app.azurewebsites.net/health
```

Should return `{"status":"ok"}`.

Test login (demo users — password is always `readytobuild`):

```powershell
curl.exe -X POST https://ready2build-app.azurewebsites.net/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"user_id\":\"admin.user\",\"password\":\"readytobuild\"}"
```

| User ID | Role |
|---------|------|
| `admin.user` | admin |
| `planner.user` | planner |
| `sourcing.user` | sourcing |
| `exec.user` | exec |

## 7. Login shows "Invalid credentials" or "Server unavailable"

If the browser shows a generic login error, check whether the **API is running** first:

1. Open `https://ready2build-app.azurewebsites.net/health`
   - **503 / Application Error** → Python app did not start (not a password problem).
   - **`{"status":"ok"}`** → API is up; then verify user id is exact (e.g. `admin.user`, not email).

2. **503 fixes** (most common on zip deploy):
   - `SCM_DO_BUILD_DURING_DEPLOYMENT=true` so Oryx runs `pip install` and creates `antenv`
   - Startup command: `bash startup.sh` (uses `antenv` + gunicorn)
   - `WEBSITES_PORT=8000`
   - Python stack **3.11** (Linux)
   - Redeploy the **latest** `deploy.zip` with `--clean true`

3. **View startup logs** (Kudu):  
   https://ready2build-app.scm.azurewebsites.net/api/logs/docker  
   Look for `ModuleNotFoundError` (deps not installed) or pip failures on `snowflake-connector-python`.

4. **Snowflake App Settings** must be set (login works without them, but data pages will fail after sign-in).
