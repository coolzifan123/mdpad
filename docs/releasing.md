# Releasing a new version

1. Set the version in `package.json`, `src-tauri/tauri.conf.json` and
   `src-tauri/Cargo.toml` (all three the same, e.g. `0.3.0`).
2. Write the release text in `docs/releases/v0.3.0.md`.
3. Commit, then tag and push:

   ```powershell
   git tag v0.3.0
   git push origin v0.3.0
   ```

GitHub Actions builds the installer, signs it for automatic updates, and
publishes the release with `latest.json`. Installed copies of MdPad find it
within a day (or at once with Help → Check for Updates).

## The update signing key (one-time setup)

Updates are signed so MdPad only installs updates made by you. The public
key is in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). The private
key is a file on the maintainer's computer, by default
`C:\Users\<you>\.tauri\mdpad-updater.key`. Keep a backup of it somewhere
safe: without it, existing installs can't be updated automatically.

GitHub needs the private key as a repository secret named
`TAURI_SIGNING_PRIVATE_KEY`:

```powershell
Get-Content "$HOME\.tauri\mdpad-updater.key" -Raw | gh secret set TAURI_SIGNING_PRIVATE_KEY -R coolzifan123/mdpad
```

(or paste the file's contents under Settings → Secrets and variables →
Actions on GitHub). The key has no password.
